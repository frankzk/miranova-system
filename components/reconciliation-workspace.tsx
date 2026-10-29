"use client";

import { useState } from "react";
import {
  bankCandidates,
  usd,
  type BankAudit,
  type BankEntry,
  type BankMatch,
  type Company,
  type EntrySource,
} from "@/lib/reconciliation";
import { BankEntryForm, BankReasonForm } from "./reconciliation-forms";
import { SideSheet } from "./side-sheet";
import { BankLinkPicker } from "./bank-link-picker";

type Props = {
  company: Company;
  today: string;
  entries: BankEntry[];
  matches: BankMatch[];
  audit: BankAudit[];
  names: Record<string, string>;
};
const activity: Record<string, string> = {
  registered: "Movimiento registrado",
  edited: "Movimiento corregido",
  reconciled: "Conciliación confirmada",
  reversed: "Conciliación revertida",
  voided: "Movimiento anulado",
};
const stamp = (s: string) =>
  new Intl.DateTimeFormat("es-PE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Lima",
  }).format(new Date(s));

export function BankWorkspace({
  company,
  today,
  entries,
  matches,
  audit,
  names,
}: Props) {
  const [view, setView] = useState("entries");
  const [source, setSource] = useState<EntrySource>("mercury");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const active = matches.filter((m) => !m.reversed_at);
  const matched = new Set(active.flatMap((m) => [m.boxful_id, m.mercury_id]));
  const pending = entries.filter((e) => !e.void_reason && !matched.has(e.id));
  const boxful = pending.filter((e) => e.source === "boxful");
  const mercury = pending.filter((e) => e.source === "mercury");
  const byId = new Map(entries.map((e) => [e.id, e]));
  const query = search.trim().toLowerCase();
  const inRange = (e: BankEntry) =>
    (!from || e.occurred_on >= from) && (!to || e.occurred_on <= to);
  const contains = (e: BankEntry) =>
    !query ||
    [
      e.reference,
      e.counterparty,
      e.bank_account,
      e.notes,
      usd(e.amount_cents),
      String(e.amount_cents / 100),
    ].some((s) => s.toLowerCase().includes(query));
  const visible = (e: BankEntry) => inRange(e) && contains(e);
  const visibleMatches = matches.filter((m) => {
    const b = m.boxful_snapshot,
      r = m.mercury_snapshot;
    return (
      (view === "reversed" ? !!m.reversed_at : !m.reversed_at) &&
      !!b &&
      !!r &&
      (inRange(b) || inRange(r)) &&
      (contains(b) || contains(r))
    );
  });
  const sum = (rows: BankEntry[]) =>
    rows.reduce((s, e) => s + e.amount_cents, 0);
  const label = company === "mireva" ? "Mireva" : "Miranova";

  function entryPanel(source: EntrySource) {
    const rows = entries.filter((entry) => entry.source === source);
    const filtered = rows
      .filter(visible)
      .filter(
        (entry) =>
          status === "all" ||
          (status === "voided"
            ? !!entry.void_reason
            : !entry.void_reason &&
              (status === "linked"
                ? matched.has(entry.id)
                : !matched.has(entry.id))),
      );
    return (
      <section
        className="table-wrap bank-ledger"
        aria-label={
          source === "mercury" ? "Registros Mercury" : "Transferencias Boxful"
        }
      >
        <div className="panel-head">
          <div>
            <h2>
              {source === "mercury"
                ? "Abonos de Mercury"
                : "Transferencias de Boxful"}
            </h2>
            <span className="hint">
              {filtered.length} de {rows.length} registros ·{" "}
              {source === "mercury" ? "Recibido en USD" : "Enviado en USD"}
            </span>
          </div>
          <SideSheet
            trigger={
              source === "mercury"
                ? "Registrar abono Mercury"
                : "Registrar PDF Boxful"
            }
            triggerClass="btn btn-primary"
            title={
              source === "mercury"
                ? "Registrar abono Mercury"
                : "Registrar transferencia Boxful"
            }
            sub={label}
          >
            <BankEntryForm company={company} source={source} today={today} />
          </SideSheet>
        </div>
        {filtered.length ? (
          <div className="bank-table-scroll">
            <table className="bank-table bank-register-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>
                    Referencia / {source === "mercury" ? "remitente" : "emisor"}
                  </th>
                  <th className="num">
                    {source === "mercury" ? "Recibido USD" : "Enviado USD"}
                  </th>
                  <th>
                    {source === "mercury"
                      ? "Transferencia Boxful vinculada"
                      : "Abono Mercury vinculado"}
                  </th>
                  <th>Estado</th>
                  <th>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => {
                  const match = active.find(
                    (item) =>
                      item.boxful_id === entry.id ||
                      item.mercury_id === entry.id,
                  );
                  const linked = match
                    ? source === "mercury"
                      ? match.boxful_snapshot
                      : match.mercury_snapshot
                    : undefined;
                  return (
                    <tr key={entry.id}>
                      <td className="bank-date-cell">{entry.occurred_on}</td>
                      <td>
                        <strong className="bank-ref">{entry.reference}</strong>
                        <span className="bank-meta">
                          {entry.counterparty}
                          {entry.bank_account ? " · " + entry.bank_account : ""}
                        </span>
                        {entry.notes.startsWith("Empresa por confirmar.") && <span className="pill" data-tone="warning">Empresa por confirmar</span>}
                        {source === "boxful" && entry.document_path && (
                          <a
                            href={"/api/reconciliation/document/" + entry.id}
                            target="_blank"
                            rel="noreferrer"
                            className="bank-meta"
                          >
                            Ver PDF ↗
                          </a>
                        )}
                        {source === "boxful" &&
                          entry.original_currency !== "USD" && (
                            <span className="bank-meta">
                              Original:{" "}
                              {(
                                entry.original_amount_cents / 100
                              ).toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{" "}
                              {entry.original_currency}
                            </span>
                          )}
                      </td>
                      <td className="num bank-amount">
                        {usd(entry.amount_cents)}
                      </td>
                      <td>
                        {linked ? (
                          <div className="bank-linked-entry">
                            <strong className="bank-ref">
                              {linked.reference}
                            </strong>
                            <span className="bank-meta">
                              {linked.occurred_on} · {usd(linked.amount_cents)}
                            </span>
                            {source === "mercury" && linked.document_path && (
                              <a
                                href={
                                  "/api/reconciliation/document/" + linked.id
                                }
                                className="bank-meta"
                                target="_blank"
                                rel="noreferrer"
                              >
                                Ver PDF Boxful ↗
                              </a>
                            )}
                            <span className="bank-meta">
                              Comisión: {usd(match!.fee_cents)} USD
                            </span>
                            <SideSheet
                              trigger="Ver vínculo"
                              triggerClass="btn btn-ghost btn-sm"
                              title="Vínculo confirmado"
                              sub={label}
                            >
                              <MatchSnapshot match={match!} />
                              <BankReasonForm
                                company={company}
                                match={match!}
                              />
                            </SideSheet>
                          </div>
                        ) : entry.void_reason ? (
                          <span className="muted">—</span>
                        ) : source === "mercury" ? (
                          <BankLinkPicker
                            mercury={entry}
                            candidates={bankCandidates(entry, entries, matches)}
                          />
                        ) : (
                          <span className="bank-meta">
                            Selecciona esta transferencia desde una fila de
                            Mercury.
                          </span>
                        )}
                      </td>
                      <td>
                        <span
                          className="pill"
                          data-tone={
                            entry.void_reason
                              ? "neutral"
                              : match
                                ? "success"
                                : "warning"
                          }
                        >
                          {entry.void_reason
                            ? "Anulado"
                            : match
                              ? "Vinculado"
                              : "Sin vincular"}
                        </span>
                      </td>
                      <td>
                        <SideSheet
                          trigger="Detalle"
                          triggerClass="btn btn-ghost btn-sm"
                          title={entry.reference}
                          sub={label}
                        >
                          <EntryDetail
                            entry={entry}
                            names={names}
                            today={today}
                            editable={!entry.void_reason && !match}
                          />
                        </SideSheet>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="bank-empty">
            <strong>
              {rows.length
                ? "Sin resultados con estos filtros"
                : source === "mercury"
                  ? "Registra tu primer abono Mercury"
                  : "Registra tu primera transferencia Boxful"}
            </strong>
            <p>
              {rows.length
                ? "Prueba otra referencia o cambia el estado y las fechas."
                : source === "mercury"
                  ? "Cada abono tendrá su selector para vincular una transferencia Boxful."
                  : "Adjunta el PDF y registra el importe enviado en USD. Luego podrás elegir esta transferencia desde Mercury."}
            </p>
          </div>
        )}
        <div className="bank-ledger-foot">
          <span>Total visible · sin anulados</span>
          <strong>
            {usd(sum(filtered.filter((entry) => !entry.void_reason)))} USD
          </strong>
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="bank-source-nav">
        <div
          className="bank-source-tabs"
          role="tablist"
          aria-label="Registros bancarios"
        >
          {(["mercury", "boxful"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              data-source={item}
              id={"bank-tab-" + item}
              aria-controls={"bank-panel-" + item}
              aria-selected={source === item}
              tabIndex={source === item ? 0 : -1}
              onClick={() => {
                setSource(item);
                setView("entries");
              }}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "mercury"
                    : event.key === "End"
                      ? "boxful"
                      : item === "mercury"
                        ? "boxful"
                        : "mercury";
                setSource(next);
                setView("entries");
                event.currentTarget.parentElement
                  ?.querySelector<HTMLButtonElement>(
                    'button[data-source="' + next + '"]',
                  )
                  ?.focus();
              }}
            >
              {item === "mercury" ? "Mercury" : "Boxful"}
              <span className="tag">
                {entries.filter((entry) => entry.source === item).length}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          aria-pressed={view !== "entries"}
          onClick={() => setView(view === "entries" ? "matched" : "entries")}
        >
          {view === "entries" ? "Ver historial" : "Volver a registros"}
        </button>
      </div>
      <section
        className="metrics bank-metrics"
        aria-label={`Historial completo de ${label}, en USD`}
      >
        <div className="metric">
          <span className="label">Boxful pendiente</span>
          <span className="value">{usd(sum(boxful))}</span>
          <span className="foot">{boxful.length} liquidaciones · USD</span>
        </div>
        <div className="metric">
          <span className="label">Mercury sin asignar</span>
          <span className="value">{usd(sum(mercury))}</span>
          <span className="foot">{mercury.length} abonos · USD</span>
        </div>
        <div className="metric">
          <span className="label">Recibido conciliado</span>
          <span className="value">
            {usd(
              active.reduce(
                (s, m) => s + (byId.get(m.mercury_id)?.amount_cents ?? 0),
                0,
              ),
            )}
          </span>
          <span className="foot">{active.length} cruces activos · USD</span>
        </div>
        <div className="metric">
          <span className="label">Comisiones confirmadas</span>
          <span className="value">
            {usd(active.reduce((s, m) => s + m.fee_cents, 0))}
          </span>
          <span className="foot">De cruces activos · USD</span>
        </div>
      </section>
      <p className="bank-scope-note">
        Resumen del historial completo de {label}. Los filtros de abajo solo
        afectan las listas.
      </p>
      {view !== "entries" && (
        <div
          className="bank-view-controls"
          aria-label="Historial de movimientos"
        >
          {[
            { id: "matched", text: "Conciliados", n: active.length },
            {
              id: "reversed",
              text: "Revertidos",
              n: matches.length - active.length,
            },
            {
              id: "voided",
              text: "Anulados",
              n: entries.filter((e) => e.void_reason).length,
            },
            { id: "audit", text: "Actividad", n: null },
          ].map((v) => (
            <button
              key={v.id}
              className="btn"
              aria-pressed={view === v.id}
              onClick={() => setView(v.id)}
            >
              {v.text}
              {v.n !== null && <span className="tag">{v.n}</span>}
            </button>
          ))}
        </div>
      )}
      {view !== "audit" && (
        <div className="bank-filters">
          <label className="field bank-search">
            <span>Buscar movimiento</span>
            <input
              className="input"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Referencia, remitente, cuenta o monto…"
            />
          </label>
          {view === "entries" && (
            <label className="field">
              <span>Estado</span>
              <select
                className="select"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="all">Todos los registros</option>
                <option value="pending">Sin vincular</option>
                <option value="linked">Vinculados</option>
                <option value="voided">Anulados</option>
              </select>
            </label>
          )}
          <label className="field">
            <span>Desde</span>
            <input
              className="input"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Hasta</span>
            <input
              className="input"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          {(search || from || to) && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                setSearch("");
                setFrom("");
                setTo("");
              }}
            >
              Limpiar
            </button>
          )}
        </div>
      )}
      {from && to && from > to && (
        <p className="banner" data-tone="warning" role="alert">
          La fecha de inicio debe ser anterior a la fecha final.
        </p>
      )}
      {(["mercury", "boxful"] as const).map((item) => (
        <div
          key={item}
          role="tabpanel"
          id={"bank-panel-" + item}
          aria-labelledby={"bank-tab-" + item}
          hidden={view !== "entries" || source !== item}
        >
          {source === item && view === "entries" && (
            <>
              <p className="bank-register-help">
                {item === "mercury"
                  ? "En cada fila, abre Vincular Boxful y elige la transferencia que corresponde a ese abono."
                  : "Registra aquí cada transferencia y su PDF. Podrás vincularla desde la pestaña Mercury."}
              </p>
              {entryPanel(item)}
            </>
          )}
        </div>
      ))}
      {(view === "matched" || view === "reversed") && (
        <section className="table-wrap">
          <div className="panel-head">
            <h2>
              {view === "matched"
                ? "Conciliaciones confirmadas"
                : "Conciliaciones revertidas"}
            </h2>
            <span className="hint">Las fechas filtran Boxful o Mercury</span>
          </div>
          {visibleMatches.length ? (
            <div className="bank-table-scroll">
              <table className="bank-table">
                <thead>
                  <tr>
                    <th>Liquidación Boxful</th>
                    <th>Abono Mercury</th>
                    <th className="num">Comisión USD</th>
                    <th>Confirmación</th>
                    <th>
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMatches.map((m) => {
                    const b = m.boxful_snapshot,
                      r = m.mercury_snapshot;

                    return (
                      <tr key={m.id}>
                        <td>
                          <strong className="bank-ref">{b.reference}</strong>
                          <span className="bank-meta">{b.occurred_on}</span>
                          <strong>{usd(b.amount_cents)}</strong>
                          {b.document_path && (
                            <a
                              className="bank-meta"
                              href={`/api/reconciliation/document/${b.id}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Ver PDF ↗
                            </a>
                          )}
                        </td>
                        <td>
                          <strong className="bank-ref">{r.reference}</strong>
                          <span className="bank-meta">
                            {r.occurred_on} · {r.bank_account}
                          </span>
                          <strong>{usd(r.amount_cents)}</strong>
                        </td>
                        <td className="num">
                          {usd(m.fee_cents)}
                          <span className="bank-meta">
                            {m.fee_note || "Sin comisión"}
                          </span>
                        </td>
                        <td>
                          <span
                            className="pill"
                            data-tone={m.reversed_at ? "neutral" : "success"}
                          >
                            {m.reversed_at ? "Revertida" : "Conciliada"}
                          </span>
                          <span className="bank-meta">
                            {names[m.created_by] ?? "Usuario"} ·{" "}
                            {stamp(m.created_at)}
                          </span>
                          <details className="bank-snapshot">
                            <summary>Ver datos confirmados</summary>
                            <MatchSnapshot match={m} />
                          </details>
                          {m.reversed_at && (
                            <>
                              <span className="bank-meta">
                                Revirtió{" "}
                                {names[m.reversed_by ?? ""] ?? "Usuario"} ·{" "}
                                {stamp(m.reversed_at)}
                              </span>
                              <span className="bank-meta">
                                {m.reversal_reason}
                              </span>
                              <span className="hint">
                                Se muestran los datos conservados al conciliar.
                                Los movimientos actuales pueden haberse
                                corregido después.
                              </span>
                              <span className="hint">
                                Versiones al conciliar: Boxful{" "}
                                {m.boxful_version} · Mercury {m.mercury_version}
                              </span>
                            </>
                          )}
                        </td>
                        <td>
                          {!m.reversed_at && (
                            <SideSheet
                              trigger="Revertir"
                              triggerClass="btn btn-ghost btn-sm"
                              title="Revertir conciliación"
                              sub={`${b.reference} → ${r.reference}`}
                            >
                              <BankReasonForm company={company} match={m} />
                            </SideSheet>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bank-empty">
              <strong>
                {view === "matched"
                  ? "Todavía no hay cruces confirmados"
                  : "No hay conciliaciones revertidas"}
              </strong>
              <p>
                Los cruces de esta empresa aparecerán aquí con su comisión,
                usuario y fecha.
              </p>
            </div>
          )}
        </section>
      )}
      {view === "voided" && (
        <section className="table-wrap">
          <div className="panel-head">
            <h2>Movimientos anulados</h2>
          </div>
          {entries.filter((e) => e.void_reason && visible(e)).length ? (
            <ul className="bank-activity">
              {entries
                .filter((e) => e.void_reason && visible(e))
                .map((e) => (
                  <li key={e.id}>
                    <div>
                      <strong>
                        {e.source === "boxful" ? "Boxful" : "Mercury"} ·{" "}
                        {e.reference}
                      </strong>
                      <p>{e.void_reason}</p>
                      <span className="hint">
                        {e.occurred_on} · {usd(e.amount_cents)} USD
                      </span>
                    </div>
                    <SideSheet trigger="Detalle" title={e.reference}>
                      <EntryDetail entry={e} names={names} today={today} />
                    </SideSheet>
                  </li>
                ))}
            </ul>
          ) : (
            <div className="bank-empty">
              <strong>No hay movimientos anulados con estos filtros</strong>
            </div>
          )}
        </section>
      )}
      {view === "audit" && (
        <section className="table-wrap">
          <div className="panel-head">
            <h2>Actividad de {label}</h2>
            <span className="hint">Últimos 100 eventos · Hora de Lima</span>
          </div>
          {audit.length ? (
            <ul className="bank-activity">
              {audit.map((a) => (
                <li key={a.id}>
                  <div>
                    <strong>{activity[a.operation] ?? a.operation}</strong>
                    <p>
                      {names[a.actor_id] ?? "Usuario"} · {stamp(a.created_at)}
                    </p>
                    <span className="hint">
                      {String(
                        a.snapshot.reference ??
                          `${(a.snapshot.boxful_snapshot as BankEntry | undefined)?.reference ?? "Boxful"} → ${(a.snapshot.mercury_snapshot as BankEntry | undefined)?.reference ?? "Mercury"}`,
                      )}
                    </span>
                    <details>
                      <summary>Datos guardados en este evento</summary>
                      {a.entity_type === "bank_matches" ? (
                        <MatchSnapshot
                          match={a.snapshot as unknown as BankMatch}
                        />
                      ) : (
                        <EntrySnapshot
                          entry={a.snapshot as unknown as BankEntry}
                        />
                      )}
                    </details>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="bank-empty">
              <strong>El historial comienza con tu primer registro</strong>
              <p>
                Aquí quedarán las altas, correcciones, conciliaciones,
                reversiones y anulaciones.
              </p>
            </div>
          )}
        </section>
      )}
    </>
  );
}

function EntryDetail({
  entry,
  names,
  today,
  editable = false,
}: {
  entry: BankEntry;
  names: Record<string, string>;
  today: string;
  editable?: boolean;
}) {
  return (
    <div className="bank-form">
      <dl className="bank-audit-data">
        <div>
          <dt>Registró</dt>
          <dd>
            {names[entry.created_by] ?? "Usuario"} · {stamp(entry.created_at)}
          </dd>
        </div>
        <div>
          <dt>Última actualización</dt>
          <dd>
            {names[entry.updated_by] ?? "Usuario"} · {stamp(entry.updated_at)}
          </dd>
        </div>
        <div>
          <dt>Versión</dt>
          <dd>{entry.version}</dd>
        </div>
      </dl>
      {editable ? (
        <>
          <BankEntryForm
            company={entry.company}
            source={entry.source}
            entry={entry}
            today={today}
          />
          <details className="bank-void">
            <summary>Anular este movimiento</summary>
            <BankReasonForm company={entry.company} entry={entry} />
          </details>
        </>
      ) : (
        <>
          <p>
            {entry.reference} · {usd(entry.amount_cents)} USD
          </p>
          <p className="muted">{entry.notes}</p>
          {entry.document_path && (
            <a
              className="btn"
              href={`/api/reconciliation/document/${entry.id}`}
              target="_blank"
              rel="noreferrer"
            >
              Ver PDF original
            </a>
          )}
        </>
      )}
    </div>
  );
}

function EntrySnapshot({ entry }: { entry: BankEntry }) {
  const rows = [
    ["Empresa", entry.company === "mireva" ? "Mireva" : "Miranova"],
    ["Origen", entry.source === "boxful" ? "Boxful" : "Mercury"],
    ["Referencia", entry.reference],
    ["Fecha", entry.occurred_on],
    ["Importe USD", usd(entry.amount_cents)],
    [
      "Monto original",
      `${(entry.original_amount_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${entry.original_currency}`,
    ],
    ["Emisor / remitente", entry.counterparty],
    ["Cuenta", entry.bank_account],
    ["Notas", entry.notes],
    ["PDF", entry.document_name],
    ["Motivo de anulación", entry.void_reason],
  ];
  return (
    <dl className="bank-audit-data">
      {rows
        .filter(([, value]) => !!value)
        .map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function MatchSnapshot({ match }: { match: BankMatch }) {
  return (
    <>
      <p className="hint">
        Comisión: {usd(match.fee_cents)} USD ·{" "}
        {match.fee_note || "Sin comisión"}
      </p>
      {match.reversal_reason && (
        <p className="hint">Motivo de reversión: {match.reversal_reason}</p>
      )}
      <h3 className="bank-snapshot-title">Liquidación Boxful al conciliar</h3>
      <EntrySnapshot entry={match.boxful_snapshot} />
      <h3 className="bank-snapshot-title">Abono Mercury al conciliar</h3>
      <EntrySnapshot entry={match.mercury_snapshot} />
    </>
  );
}
