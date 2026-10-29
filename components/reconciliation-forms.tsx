"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  prepareBankPdf,
  readBankPdf,
  reconcileBank,
  reverseBankMatch,
  saveBankEntry,
  voidBankEntry,
} from "@/app/(app)/reconciliation/actions";
import {
  MAX_BANK_PDF,
  ORIGINAL_CURRENCIES,
  cents,
  decimal,
  matchProblem,
  usd,
  type BankEntry,
  type BankMatch,
  type BankState,
  type Company,
  type EntrySource,
} from "@/lib/reconciliation";
import { SubmitButton } from "./submit-button";
import { useSheet } from "./side-sheet";
import {
  applyBoxfulProposal,
  type BoxfulAutofill,
  type BoxfulReadResult,
} from "@/lib/boxful-document";

function Message({ state }: { state: BankState }) {
  return state ? (
    <p
      className="im-msg"
      data-ok={state.ok}
      role={state.ok ? "status" : "alert"}
    >
      {state.msg}
    </p>
  ) : null;
}

function useCloseOnSave(state: BankState) {
  const sheet = useSheet();
  useEffect(() => {
    if (state?.ok) sheet?.close();
  }, [state, sheet]);
}

export function BankEntryForm({
  company,
  source,
  today,
  entry,
}: {
  company: Company;
  source: EntrySource;
  today: string;
  entry?: BankEntry;
}) {
  const [state, run, saving] = useActionState(saveBankEntry, null);
  const [fields, setFields] = useState<BoxfulAutofill>({
    reference: entry?.reference ?? "",
    occurred_on: entry?.occurred_on ?? (source === "mercury" ? today : ""),
    amount: entry ? decimal(entry.amount_cents) : "",
    original_currency: entry?.original_currency ?? "USD",
    original_amount:
      entry && entry.original_currency !== "USD"
        ? decimal(entry.original_amount_cents)
        : "",
  });
  const currency = fields.original_currency;
  const setField = (key: keyof BoxfulAutofill, value: string) =>
    setFields((current) => ({ ...current, [key]: value }));
  const [uploading, setUploading] = useState(false);
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState<BoxfulReadResult | null>(null);
  const requestId = useRef(0);
  const [uploadError, setUploadError] = useState("");
  const [pdf, setPdf] = useState<{ path: string; name: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useCloseOnSave(state);
  useEffect(
    () => () => {
      requestId.current++;
    },
    [],
  );

  async function readPdf(
    document: { path: string; name: string },
    beforeRead: BoxfulAutofill = fields,
  ) {
    const id = ++requestId.current;
    setReading(true);
    setRead(null);
    try {
      const result = await readBankPdf(company, document.path);
      if (id !== requestId.current) return;
      setRead(result);
      if (result.ok)
        setFields((current) =>
          applyBoxfulProposal(current, beforeRead, result.proposal.fields),
        );
    } catch {
      if (id === requestId.current)
        setRead({
          ok: false,
          msg: "No se pudo leer el PDF. Puedes volver a intentarlo o llenar los datos manualmente.",
        });
    } finally {
      if (id === requestId.current) setReading(false);
    }
  }

  async function upload(file: File) {
    setUploadError("");
    if (
      !file.name.toLowerCase().endsWith(".pdf") ||
      file.size <= 0 ||
      file.size > MAX_BANK_PDF
    ) {
      setUploadError("Selecciona un PDF de hasta 15 MB.");
      return;
    }
    const uploadId = ++requestId.current;
    setPdf(null);
    setRead(null);
    setPreview(URL.createObjectURL(file));
    const empty = {
      reference: "",
      occurred_on: "",
      amount: "",
      original_currency: "USD",
      original_amount: "",
    };
    setFields(empty);
    setUploading(true);
    try {
      const start = await prepareBankPdf(company, file.name, file.size);
      if (uploadId !== requestId.current) return;
      if (!start.ok) {
        setUploadError(start.msg);
        return;
      }
      const body = new FormData();
      body.append("cacheControl", "3600");
      body.append("", new File([file], file.name, { type: "application/pdf" }));
      const result = await fetch(start.url, {
        method: "PUT",
        headers: { "x-upsert": "false" },
        body,
      });
      if (!result.ok) throw new Error("upload");
      if (uploadId !== requestId.current) return;
      const document = { path: start.path, name: file.name };
      setPdf(document);
      setUploading(false);
      await readPdf(document, empty);
    } catch {
      setUploadError("No se pudo cargar el PDF. Vuelve a seleccionarlo.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form action={run} className="bank-form">
      <input type="hidden" name="company" value={company} />
      <input type="hidden" name="source" value={source} />
      {entry && (
        <>
          <input type="hidden" name="id" value={entry.id} />
          <input type="hidden" name="version" value={entry.version} />
        </>
      )}
      {source === "boxful" && !entry && (
        <label className="bank-upload field">
          <span>Comprobante de Boxful · PDF</span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={uploading || reading || saving}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <span className="hint" role="status">
            {uploading
              ? "Cargando PDF…"
              : reading
                ? "Leyendo fecha, referencia e importe del PDF…"
                : pdf
                  ? `${pdf.name} · cargado`
                  : "Hasta 15 MB. La fecha, referencia e importe se completan al subirlo para que los revises."}
          </span>
        </label>
      )}
      <input type="hidden" name="document_path" value={pdf?.path ?? ""} />
      <input type="hidden" name="document_name" value={pdf?.name ?? ""} />
      {preview && (
        <a href={preview} target="_blank" rel="noreferrer" className="btn">
          Abrir PDF para revisar ↗
        </a>
      )}
      {uploadError && (
        <p className="im-msg" data-ok={false} role="alert">
          {uploadError}
        </p>
      )}
      {reading && (
        <p className="banner" data-tone="info" role="status">
          <span className="spinner" aria-hidden="true" /> Leyendo el
          comprobante… Los datos aparecerán aquí para revisarlos antes de
          guardar.
        </p>
      )}
      {read && (
        <div className="bank-autofill-result">
          <p
            className="banner"
            data-tone={read.ok ? "info" : "warning"}
            role={read.ok ? "status" : "alert"}
          >
            {read.ok
              ? "Lectura terminada. Revisa la fecha, referencia e importe propuestos contra el PDF antes de guardar."
              : read.msg}
          </p>
          {read.ok && read.proposal.warnings.length > 0 && (
            <ul
              className="bank-read-warnings"
              aria-label="Avisos de la lectura"
            >
              {read.proposal.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          {read.ok && Object.keys(read.proposal.evidence).length > 0 && (
            <details className="bank-read-evidence">
              <summary>Ver datos encontrados en el PDF</summary>
              <dl className="bank-audit-data">
                {Object.entries(read.proposal.evidence).map(
                  ([key, evidence]) => (
                    <div key={key}>
                      <dt>
                        {
                          (
                            {
                              reference: "Referencia",
                              occurred_on: "Fecha",
                              amount: "Importe USD",
                              original_currency: "Moneda original",
                              original_amount: "Monto original",
                            } as Record<string, string>
                          )[key]
                        }
                      </dt>
                      <dd>{evidence}</dd>
                    </div>
                  ),
                )}
              </dl>
            </details>
          )}
          {!read.ok && pdf && (
            <button
              type="button"
              className="btn"
              disabled={reading || uploading || saving}
              onClick={() => void readPdf(pdf)}
            >
              Volver a leer PDF
            </button>
          )}
        </div>
      )}
      {entry?.document_path && (
        <a
          href={`/api/reconciliation/document/${entry.id}`}
          target="_blank"
          rel="noreferrer"
          className="btn"
        >
          Ver PDF original
        </a>
      )}
      <fieldset
        className="bank-form-fields"
        disabled={uploading || reading || saving}
      >
        <legend className="sr-only">Datos de la transferencia</legend>
        <div className="bank-field-grid">
          <label className="field bank-wide">
            <span>
              {source === "boxful"
                ? "Referencia de liquidación / transferencia"
                : "ID o referencia de transacción Mercury"}
            </span>
            <input
              className="input"
              name="reference"
              required
              maxLength={160}
              value={fields.reference}
              onChange={(event) => setField("reference", event.target.value)}
              placeholder={
                source === "boxful"
                  ? "Referencia única del comprobante"
                  : "Identificador del abono en Mercury"
              }
            />
            <span className="hint">
              Debe ser única para este origen y empresa, aunque dos pagos tengan
              el mismo monto.
            </span>
          </label>
          <label className="field">
            <span>
              {source === "boxful"
                ? "Fecha de transferencia"
                : "Fecha del abono"}
            </span>
            <input
              className="input"
              name="occurred_on"
              type="date"
              max={today}
              required
              value={fields.occurred_on}
              onChange={(event) => setField("occurred_on", event.target.value)}
            />
          </label>
          <label className="field">
            <span>
              {source === "boxful"
                ? "Importe enviado · USD"
                : "Importe recibido · USD"}
            </span>
            <input
              className="input"
              name="amount"
              inputMode="decimal"
              required
              placeholder="0.00"
              value={fields.amount}
              onChange={(event) => setField("amount", event.target.value)}
            />
            <span className="hint">
              {source === "boxful"
                ? "Monto de la transferencia en USD, antes de la comisión bancaria."
                : "El abono neto que aparece en Mercury."}
            </span>
          </label>
          {source === "boxful" && (
            <>
              <label className="field">
                <span>Moneda original del PDF</span>
                <select
                  className="select"
                  name="original_currency"
                  value={currency}
                  onChange={(e) =>
                    setField("original_currency", e.target.value)
                  }
                >
                  {ORIGINAL_CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              {currency !== "USD" && (
                <label className="field">
                  <span>Monto original · {currency}</span>
                  <input
                    className="input"
                    name="original_amount"
                    inputMode="decimal"
                    required
                    placeholder="0.00"
                    value={fields.original_amount}
                    onChange={(event) =>
                      setField("original_amount", event.target.value)
                    }
                  />
                  <span className="hint">
                    La conversión a USD corresponde a esta transferencia, no a
                    una tasa actual.
                  </span>
                </label>
              )}
            </>
          )}
          <label className="field">
            <span>
              {source === "mercury" ? "Remitente" : "Emisor / descripción"}
            </span>
            <input
              className="input"
              name="counterparty"
              maxLength={200}
              required={source === "mercury"}
              defaultValue={
                entry?.counterparty ?? (source === "boxful" ? "Boxful" : "")
              }
              placeholder="Como aparece en el movimiento"
            />
          </label>
          <label className="field">
            <span>
              {source === "mercury"
                ? "Cuenta Mercury"
                : "Cuenta destino (opcional)"}
            </span>
            <input
              className="input"
              name="bank_account"
              maxLength={100}
              required={source === "mercury"}
              defaultValue={entry?.bank_account}
              placeholder="Ej.: Checking · últimos 4 dígitos"
            />
          </label>
          <label className="field bank-wide">
            <span>Notas (opcional)</span>
            <textarea
              className="input"
              name="notes"
              rows={3}
              maxLength={2000}
              defaultValue={entry?.notes}
              placeholder="Detalle de la transferencia o conversión aplicada"
            />
          </label>
        </div>
      </fieldset>
      <Message state={state} />
      <SubmitButton
        className="btn btn-primary"
        pending="Guardando…"
        disabled={
          uploading || reading || (source === "boxful" && !entry && !pdf)
        }
      >
        {entry
          ? "Guardar cambios"
          : source === "boxful"
            ? "Registrar liquidación"
            : "Registrar abono"}
      </SubmitButton>
    </form>
  );
}

export function BankMatchForm({
  mercury,
  candidates,
  onLinked,
}: {
  mercury: BankEntry;
  candidates: BankEntry[];
  onLinked: () => void;
}) {
  const [state, run] = useActionState(reconcileBank, null);
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [fee, setFee] = useState("0.00");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    if (state?.ok) onLinked();
  }, [state, onLinked]);
  const boxful = candidates.find((entry) => entry.id === selected);
  const query = search.trim().toLowerCase();
  const shown = candidates.filter(
    (entry) =>
      !query ||
      [
        entry.reference,
        entry.document_name ?? "",
        entry.occurred_on,
        entry.counterparty,
        usd(entry.amount_cents),
        decimal(entry.amount_cents),
      ].some((value) => value.toLowerCase().includes(query)),
  );
  const feeCents = cents(fee);
  const problem = boxful
    ? matchProblem(boxful, mercury, feeCents ?? -1, note)
    : "Selecciona una transferencia Boxful.";
  const difference = boxful ? boxful.amount_cents - mercury.amount_cents : null;
  const sameAmounts = boxful
    ? candidates.filter((entry) => entry.amount_cents === boxful.amount_cents)
        .length
    : 0;

  return (
    <form action={run} className="bank-form">
      <input type="hidden" name="company" value={mercury.company} />
      <input type="hidden" name="mercury_id" value={mercury.id} />
      <input type="hidden" name="mercury_version" value={mercury.version} />
      <input type="hidden" name="boxful_id" value={boxful?.id ?? ""} />
      <input
        type="hidden"
        name="boxful_version"
        value={boxful?.version ?? ""}
      />
      <div className="bank-anchor-abono">
        <div>
          <span>Abono Mercury · {mercury.occurred_on}</span>
          <strong>{mercury.reference}</strong>
          <small>
            {mercury.counterparty} · {mercury.bank_account}
          </small>
        </div>
        <strong>
          {usd(mercury.amount_cents)} <small>USD</small>
        </strong>
      </div>
      <label className="field">
        <span>Transferencias Boxful disponibles</span>
        <input
          className="input"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por referencia, fecha, monto o PDF…"
        />
        <span className="hint">
          Solo sin vincular de esta empresa. Ordenadas por monto y fecha; tú
          eliges el cruce.
        </span>
      </label>
      <fieldset className="bank-candidates">
        <legend className="sr-only">Selecciona una transferencia Boxful</legend>
        {shown.map((entry) => (
          <div
            className="bank-candidate"
            key={entry.id}
            data-selected={selected === entry.id}
          >
            <label>
              <input
                type="radio"
                name="boxful-choice"
                value={entry.id}
                checked={selected === entry.id}
                onChange={() => {
                  setSelected(entry.id);
                  setConfirmed(false);
                }}
              />
              <span className="bank-candidate-info">
                <strong>{entry.reference}</strong>
                <small>
                  {entry.occurred_on} · {entry.counterparty || "Boxful"}
                </small>
                {entry.original_currency !== "USD" && (
                  <small>
                    Original: {decimal(entry.original_amount_cents)}{" "}
                    {entry.original_currency}
                  </small>
                )}
                <small>{entry.document_name || "Comprobante Boxful"}</small>
              </span>
              <span className="bank-candidate-money">
                <strong>{usd(entry.amount_cents)}</strong>
                <small>
                  {entry.amount_cents === mercury.amount_cents
                    ? "Mismo monto"
                    : "Diferencia " +
                      usd(entry.amount_cents - mercury.amount_cents)}
                </small>
              </span>
            </label>
            {entry.document_path && (
              <a
                href={"/api/reconciliation/document/" + entry.id}
                target="_blank"
                rel="noreferrer"
                className="bank-candidate-pdf"
                aria-label={"Ver PDF de " + entry.reference}
              >
                Ver PDF ↗
              </a>
            )}
          </div>
        ))}
        {!shown.length && (
          <div className="bank-empty">
            <strong>
              {candidates.length
                ? "Sin resultados"
                : "No hay transferencias Boxful disponibles"}
            </strong>
            <p>
              {candidates.length
                ? "Prueba otra referencia, monto o fecha."
                : "Registra la transferencia y su PDF en la pestaña Boxful para poder vincularla."}
            </p>
          </div>
        )}
      </fieldset>
      {boxful && (
        <div className="bank-link-review">
          <div className="bank-selected-title">
            <span className="pill" data-tone="info">
              Seleccionada
            </span>
            <strong>{boxful.reference}</strong>
          </div>
          <div className="bank-compare">
            <div>
              <span>Boxful enviado</span>
              <strong>{usd(boxful.amount_cents)}</strong>
            </div>
            <div>
              <span>Diferencia por justificar</span>
              <strong>{usd(difference ?? 0)}</strong>
            </div>
          </div>
          {sameAmounts > 1 && (
            <p className="banner" data-tone="warning">
              Hay {sameAmounts} transferencias Boxful con ese monto. Verifica la
              referencia y el PDF.
            </p>
          )}
          <label className="field">
            <span>Comisión bancaria confirmada · USD</span>
            <input
              className="input"
              name="fee"
              inputMode="decimal"
              required
              value={fee}
              onChange={(event) => {
                setFee(event.target.value);
                setConfirmed(false);
              }}
            />
            <span className="hint">
              Si existe diferencia, ingresa la comisión que verificaste en el
              comprobante.
            </span>
          </label>
          <label className="field">
            <span>
              Detalle / soporte de la comisión
              {feeCents === 0 ? " (opcional)" : ""}
            </span>
            <textarea
              className="input"
              name="fee_note"
              maxLength={1000}
              rows={2}
              required={(feeCents ?? 0) > 0}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                setConfirmed(false);
              }}
              placeholder="Concepto y referencia del comprobante bancario"
            />
          </label>
          <div className="bank-equation" data-balanced={!problem}>
            <span>Boxful {usd(boxful.amount_cents)}</span>
            <span>=</span>
            <span>Mercury {usd(mercury.amount_cents)}</span>
            <span>+</span>
            <span>Comisión {feeCents === null ? "—" : usd(feeCents)}</span>
          </div>
          <p className="hint" role="status">
            {problem || "Cuadra exactamente al centavo."}
          </p>
          <label className="bank-confirm">
            <input
              type="checkbox"
              name="confirmed"
              required
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              Revisé las referencias, fechas, cuenta y PDF. Confirmo que es la
              misma transferencia y que la comisión está sustentada.
            </span>
          </label>
        </div>
      )}
      <Message state={state} />
      <SubmitButton
        className="btn btn-primary"
        pending="Vinculando…"
        disabled={!!problem || !confirmed}
      >
        Confirmar vínculo 1:1
      </SubmitButton>
    </form>
  );
}

export function BankReasonForm({
  company,
  entry,
  match,
}: {
  company: Company;
  entry?: BankEntry;
  match?: BankMatch;
}) {
  const [state, run] = useActionState(
    match ? reverseBankMatch : voidBankEntry,
    null,
  );
  useCloseOnSave(state);
  return (
    <form action={run} className="bank-form">
      <input type="hidden" name="company" value={company} />
      <input type="hidden" name="id" value={match?.id ?? entry?.id} />
      {entry && <input type="hidden" name="version" value={entry.version} />}
      <p className="muted">
        {match
          ? "Los dos movimientos volverán a pendientes. El cruce anterior quedará en el historial."
          : "El movimiento quedará fuera de los pendientes. Se conservan el registro y su documento."}
      </p>
      <label className="field">
        <span>Motivo obligatorio</span>
        <textarea
          className="input"
          name="reason"
          required
          minLength={3}
          maxLength={500}
          rows={3}
        />
      </label>
      <Message state={state} />
      <SubmitButton className="btn btn-danger" pending="Guardando…">
        {match ? "Revertir conciliación" : "Anular movimiento"}
      </SubmitButton>
    </form>
  );
}
