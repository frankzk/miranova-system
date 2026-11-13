"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  exemptBankEntry,
  linkSettlementPdf,
  reviewSettlement,
  unexemptBankEntry,
  unlinkSettlementPdf,
} from "@/app/(app)/reconciliation/settlement-actions";
import { reconcileBank } from "@/app/(app)/reconciliation/actions";
import { originLabel, ORIGIN_COUNTRIES } from "@/lib/bank-origin";
import { usd, type BankEntry, type BankMatch, type BankState, type Company } from "@/lib/reconciliation";
import {
  STEP_GROUP,
  daysBetween,
  loosePdfs,
  money,
  settlementViews,
  signedUsd,
  type Candidate,
  type Settlement,
  type SettlementView,
  type Step,
} from "@/lib/settlements";
import type { SettlementExempt, SettlementSource } from "@/lib/settlements-data";
import { BankEntryForm } from "./reconciliation-forms";
import { SideSheet, useSheet } from "./side-sheet";
import { SubmitButton } from "./submit-button";

type Props = {
  company: Company;
  today: string;
  settlements: Settlement[];
  exempt: SettlementExempt[];
  sources: SettlementSource[];
  entries: BankEntry[];
  matches: BankMatch[];
  names: Record<string, string>;
};

type Group = "pdf" | "confirm" | "waiting" | "review";
const TILES: { id: Group; label: string; hint: string; tone: string }[] = [
  { id: "pdf", label: "Falta comprobante", hint: "Sube o elige el PDF", tone: "warning" },
  { id: "confirm", label: "Para confirmar", hint: "Ya encontramos la pareja: un clic", tone: "accent" },
  { id: "waiting", label: "Esperando", hint: "A la plataforma o a que entre a Mercury", tone: "info" },
  { id: "review", label: "Revisar", hint: "Rechazadas por la plataforma", tone: "danger" },
];

const STEP_PILL: Record<Step, { text: string; tone: string }> = {
  needs_pdf: { text: "Falta comprobante", tone: "warning" },
  confirm_pdf: { text: "Para confirmar", tone: "accent" },
  confirm_mercury: { text: "Para confirmar", tone: "accent" },
  waiting_platform: { text: "Pendiente de pago", tone: "info" },
  waiting_mercury: { text: "Esperando a Mercury", tone: "info" },
  review: { text: "Revisar", tone: "danger" },
  reviewed: { text: "Revisada", tone: "neutral" },
  closed: { text: "Cerrada", tone: "success" },
};

const platform = (s: Settlement) => (s.source === "boxful" ? "Boxful" : "Drop");
const countryName = (c: string | null) => ORIGIN_COUNTRIES.find((x) => x.id === c)?.label ?? c ?? "";
const ago = (iso: string | null) => {
  if (!iso) return "nunca";
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return min < 60 ? `hace ${min} min` : min < 48 * 60 ? `hace ${Math.round(min / 60)} h` : `hace ${Math.round(min / 1440)} días`;
};
const shortDay = (d: string) => new Intl.DateTimeFormat("es", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(d.slice(0, 10)));

function Msg({ state }: { state: BankState }) {
  return state && !state.ok ? <p className="stl-msg" role="alert">{state.msg}</p> : null;
}

function useCloseOnOk(state: BankState) {
  const sheet = useSheet();
  useEffect(() => {
    if (state?.ok) sheet?.close();
  }, [state, sheet]);
}

/** Pestañas de Conciliación: Liquidaciones (3 pasos) y los movimientos de siempre. */
export function ReconciliationTabs({ initial, board, movements }: { initial: "liq" | "mov"; board: React.ReactNode; movements: React.ReactNode }) {
  const [tab, setTab] = useState(initial);
  return (
    <>
      <nav className="segmented stl-tabs" aria-label="Vista de conciliación">
        <button type="button" aria-pressed={tab === "liq"} onClick={() => setTab("liq")}>Liquidaciones</button>
        <button type="button" aria-pressed={tab === "mov"} onClick={() => setTab("mov")}>Movimientos</button>
      </nav>
      <div hidden={tab !== "liq"}>{board}</div>
      <div hidden={tab !== "mov"}>{movements}</div>
    </>
  );
}

export function SettlementsBoard({ company, today, settlements, exempt, sources, entries, matches, names }: Props) {
  const exemptIds = useMemo(() => new Set(exempt.map((e) => e.entry_id)), [exempt]);
  const views = useMemo(() => settlementViews(settlements, entries, matches, exemptIds), [settlements, entries, matches, exemptIds]);
  const loose = useMemo(() => loosePdfs(settlements, entries, exemptIds), [settlements, entries, exemptIds]);
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const [group, setGroup] = useState<Group | null>(null);
  const [scope, setScope] = useState<"open" | "done" | "all">("open");
  const [country, setCountry] = useState("");
  const [search, setSearch] = useState("");

  const counts = Object.fromEntries(TILES.map((t) => [t.id, views.filter((v) => STEP_GROUP[v.step] === t.id)])) as Record<Group, SettlementView[]>;
  const countries = [...new Set(settlements.map((s) => s.country).filter((c): c is string => !!c))];
  const q = search.trim().toLowerCase();
  const shown = views.filter((v) => {
    const g = STEP_GROUP[v.step];
    if (group && g !== group) return false;
    if (!group && scope === "open" && g === "done") return false;
    if (!group && scope === "done" && g !== "done") return false;
    if (country && v.s.country !== country) return false;
    if (!q) return true;
    return [v.s.reference, v.s.confirmation, v.pdf?.reference ?? "", v.mercury?.reference ?? "", money(v.s.amount_cents, v.s.currency), v.expectedUsd ? usd(v.expectedUsd) : ""]
      .some((t) => t.toLowerCase().includes(q));
  });
  const needsPdf = views.filter((v) => !v.pdf && (v.step === "needs_pdf" || v.step === "confirm_pdf" || v.step === "waiting_platform"));

  if (!settlements.length) {
    return (
      <section className="stl">
        <Flow />
        <div className="bank-empty">
          <strong>{company === "mireva" ? "Las liquidaciones de Mireva están en la empresa Miranova" : "Todavía no hay liquidaciones"}</strong>
          <p>
            {company === "mireva"
              ? "Como sus PDF y sus abonos, se ven en la empresa Miranova, marcadas con operación Mireva. Cambia la empresa arriba."
              : "Se leen solas de Drop y de Boxful cada 30 minutos. Si acabas de publicar, espera la próxima sincronización."}
          </p>
        </div>
        <Sources sources={sources} />
      </section>
    );
  }

  return (
    <section className="stl">
      <Flow />
      <div className="stl-tiles" role="group" aria-label="Filtrar por lo que falta">
        {TILES.map((t) => {
          const list = counts[t.id];
          const usdSum = list.reduce((s, v) => s + (v.expectedUsd ?? 0), 0);
          return (
            <button key={t.id} type="button" className="stl-tile" data-tone={t.tone} aria-pressed={group === t.id}
              onClick={() => setGroup(group === t.id ? null : t.id)}>
              <span className="stl-tile-label"><span className="dot" aria-hidden="true" />{t.label}</span>
              <strong>{list.length}</strong>
              <span className="stl-tile-hint">{list.length ? `≈ ${usd(usdSum)} · ${t.hint}` : t.hint}</span>
            </button>
          );
        })}
      </div>

      <div className="stl-bar">
        <nav className="segmented" aria-label="Qué liquidaciones ver">
          {([["open", "Pendientes"], ["done", "Cerradas"], ["all", "Todas"]] as const).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={!group && scope === id} onClick={() => { setGroup(null); setScope(id); }}>{label}</button>
          ))}
        </nav>
        {countries.length > 1 && (
          <nav className="chips stl-chips" aria-label="País">
            <button type="button" aria-current={!country} onClick={() => setCountry("")}>Todos</button>
            {countries.map((c) => (
              <button key={c} type="button" aria-current={country === c} onClick={() => setCountry(country === c ? "" : c)}>{countryName(c)}</button>
            ))}
          </nav>
        )}
        <input className="input stl-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Referencia, confirmación o monto…" aria-label="Buscar liquidación" />
      </div>

      <div className="stl-list" role="table" aria-label="Liquidaciones y sus 3 pasos">
        <div className="stl-row stl-head" role="row">
          <span role="columnheader">Liquidación</span>
          <span role="columnheader"><b>1</b>Registrada</span>
          <span role="columnheader"><b>2</b>Comprobante</span>
          <span role="columnheader"><b>3</b>En Mercury</span>
          <span role="columnheader">Estado</span>
        </div>
        {shown.map((v) => (
          <Row key={v.s.id} v={v} company={company} today={today} loose={loose} names={names} byId={byId} />
        ))}
        {!shown.length && (
          <div className="bank-empty">
            <strong>{group || scope === "open" ? "Nada pendiente aquí" : "Sin resultados"}</strong>
            <p>{q || country ? "Prueba con otra búsqueda o país." : "Cuando Drop o Boxful registren otra liquidación aparecerá sola."}</p>
          </div>
        )}
      </div>

      <LooseBox company={company} loose={loose} exempt={exempt} byId={byId} needsPdf={needsPdf} names={names} />
      <Sources sources={sources} />
    </section>
  );
}

function Flow() {
  return (
    <p className="stl-flow">
      <span><b>1</b>Drop o Boxful la registra</span><i aria-hidden="true">→</i>
      <span><b>2</b>Llega el comprobante (PDF)</span><i aria-hidden="true">→</i>
      <span><b>3</b>Entra la plata a Mercury</span>
    </p>
  );
}

function Sources({ sources }: { sources: SettlementSource[] }) {
  if (!sources.length) return null;
  return (
    <p className="stl-sources">
      {sources.map((a) => (
        <span key={a.id} title={a.settlements_msg ?? undefined}>
          {a.name}: {a.settlements_sync_at ? `leído ${ago(a.settlements_sync_at)}` : a.settlements_msg ?? "sin leer todavía"}
        </span>
      ))}
    </p>
  );
}

function Row({ v, company, today, loose, names, byId }: {
  v: SettlementView; company: Company; today: string; loose: BankEntry[]; names: Record<string, string>; byId: Map<string, BankEntry>;
}) {
  const { s } = v;
  const pill = STEP_PILL[v.step];
  const age = daysBetween(s.requested_on, today);
  const op = originLabel(s.operation, null) ?? "";
  return (
    <div className="stl-row" role="row" data-step={v.step}>
      <div className="stl-who" role="cell">
        <strong>{op}{s.country ? <em> · {countryName(s.country)}</em> : null}</strong>
        <code>{s.reference}</code>
        <span>{platform(s)} · {shortDay(s.requested_on)}{s.shipments ? ` · ${s.shipments} envíos` : ""}</span>
        {s.confirmation && <span>Confirmación {s.confirmation}</span>}
      </div>

      {/* 1. la liquidación */}
      <div className="stl-step" role="cell" data-state={s.status === "rejected" ? "bad" : s.status === "paid" ? "done" : "wait"}>
        <span className="stl-label">1 · Registrada</span>
        <strong>{money(s.amount_cents, s.currency)}</strong>
        {s.status === "rejected" ? (
          <span className="stl-note bad">{s.status_label} en {platform(s)}{s.failure_reason ? `: ${s.failure_reason}` : ""}</span>
        ) : (
          <>
            {v.expectedUsd !== null && s.currency !== "USD" && (
              <span className="stl-meta">{s.usd_amount_cents ? `Enviado ${usd(v.expectedUsd)}` : `≈ ${usd(v.expectedUsd)} · tasa de ${platform(s)}`}</span>
            )}
            {s.status === "pending" && <span className="stl-note">{s.status_label} en {platform(s)}</span>}
          </>
        )}
      </div>

      {/* 2. el comprobante */}
      <div className="stl-step" role="cell" data-state={v.pdf ? "done" : v.step === "confirm_pdf" ? "suggest" : v.step === "needs_pdf" ? "missing" : "idle"}>
        <span className="stl-label">2 · Comprobante</span>
        {v.pdf ? (
          <>
            <strong>{usd(v.pdf.amount_cents)}</strong>
            <span className="stl-meta">
              {v.pdf.reference} · {shortDay(v.pdf.occurred_on)} ·{" "}
              <a href={`/api/reconciliation/document/${v.pdf.id}`} target="_blank" rel="noreferrer">Ver PDF ↗</a>
            </span>
            {v.expectedUsd !== null && Math.abs(v.pdf.amount_cents - v.expectedUsd) >= 100 && (
              <span className="stl-meta">{signedUsd(v.pdf.amount_cents - v.expectedUsd)} vs. lo esperado</span>
            )}
          </>
        ) : v.step === "review" || v.step === "reviewed" ? (
          <span className="stl-wait">No aplica</span>
        ) : v.step === "confirm_pdf" ? (
          <Suggestion c={v.pdfOptions.find((c) => c.strong)!} expected={v.expectedUsd}>
            <ConfirmPdf s={v.s} entry={v.pdfOptions.find((c) => c.strong)!.entry} />
            <PickPdfSheet v={v} loose={loose} label="Otro" />
          </Suggestion>
        ) : (
          <>
            <span className="stl-wait">{v.step === "waiting_platform" ? `${platform(s)} todavía no la paga` : "Todavía no llega"}</span>
            {v.step === "needs_pdf" && v.pdfOptions.length > 0 && (
              <span className="stl-note">{v.pdfOptions.length} parecido{v.pdfOptions.length === 1 ? "" : "s"}: revisa cuál es</span>
            )}
            <span className="stl-actions">
              <SideSheet trigger="Subir PDF" triggerClass="btn btn-sm" title="Comprobante de la liquidación" sub={`${s.reference} · ${money(s.amount_cents, s.currency)}`}>
                <BankEntryForm company={company} source="boxful" today={today}
                  settlement={{ id: s.id, reference: s.reference, operation: s.operation, country: s.country }} />
              </SideSheet>
              {loose.length > 0 && <PickPdfSheet v={v} loose={loose} label="Elegir" />}
            </span>
          </>
        )}
      </div>

      {/* 3. el abono en Mercury */}
      <div className="stl-step" role="cell" data-state={v.mercury ? "done" : v.step === "confirm_mercury" ? "suggest" : "idle"}>
        <span className="stl-label">3 · En Mercury</span>
        {v.mercury && v.match ? (
          <>
            <strong>{usd(v.mercury.amount_cents)}</strong>
            <span className="stl-meta">Abono del {shortDay(v.mercury.occurred_on)}</span>
            {v.match.fee_cents > 0 && <span className="stl-meta">Comisión {usd(v.match.fee_cents)}</span>}
          </>
        ) : v.pdf && v.step === "confirm_mercury" ? (
          <Suggestion c={v.mercuryOptions.find((c) => c.strong)!} expected={v.pdf.amount_cents} mercury>
            <ConfirmMercury pdf={v.pdf} m={v.mercuryOptions.find((c) => c.strong)!.entry} />
            <PickMercurySheet pdf={v.pdf} options={v.mercuryOptions} label="Otro" />
          </Suggestion>
        ) : v.pdf ? (
          <>
            <span className="stl-wait">Esperando el abono</span>
            <span className="stl-meta">Suele tardar 1–2 días</span>
            {v.mercuryOptions.length > 0 && <PickMercurySheet pdf={v.pdf} options={v.mercuryOptions} label="Elegir abono" />}
          </>
        ) : (
          <span className="stl-wait">{v.step === "review" || v.step === "reviewed" ? "No aplica" : "—"}</span>
        )}
      </div>

      <div className="stl-end" role="cell">
        <span className="pill" data-tone={pill.tone}>{pill.text}</span>
        <span className="stl-meta">{v.step === "closed" || v.step === "reviewed" ? `Pedida el ${shortDay(s.requested_on)}` : age <= 0 ? "Hoy" : `Hace ${age} día${age === 1 ? "" : "s"}`}</span>
        <SideSheet trigger="Detalle" triggerClass="btn btn-ghost btn-sm" title={`Liquidación ${s.reference}`} sub={`${originLabel(s.operation, s.country) ?? ""}`}>
          <Detail v={v} company={company} names={names} byId={byId} />
        </SideSheet>
      </div>
    </div>
  );
}

function Suggestion({ c, expected, mercury, children }: { c: Candidate; expected: number | null; mercury?: boolean; children: React.ReactNode }) {
  const diff = expected === null ? null : c.entry.amount_cents - expected;
  return (
    <>
      <strong>{usd(c.entry.amount_cents)}</strong>
      <span className="stl-meta">{mercury ? "Abono" : c.entry.reference} · {shortDay(c.entry.occurred_on)}</span>
      <span className="stl-note sug">
        {c.reason}{diff !== null && Math.abs(diff) >= 100 ? ` · ${signedUsd(diff)}` : ""}
      </span>
      <span className="stl-actions">{children}</span>
    </>
  );
}

function ConfirmPdf({ s, entry }: { s: Settlement; entry: BankEntry }) {
  const [state, run] = useActionState(linkSettlementPdf, null);
  return (
    <form action={run} className="stl-inline">
      <input type="hidden" name="settlement_id" value={s.id} />
      <input type="hidden" name="company" value={s.company} />
      <input type="hidden" name="boxful_id" value={entry.id} />
      <SubmitButton className="btn btn-primary btn-sm" pending="Confirmando…">Confirmar</SubmitButton>
      <Msg state={state} />
    </form>
  );
}

/** Mismo monto: un clic. Con diferencia (comisión), se abre el detalle para explicarla. */
function ConfirmMercury({ pdf, m }: { pdf: BankEntry; m: BankEntry }) {
  const [state, run] = useActionState(reconcileBank, null);
  const fee = pdf.amount_cents - m.amount_cents;
  if (fee !== 0) return <PickMercurySheet pdf={pdf} options={[{ entry: m, strong: true, reason: "", diffCents: fee }]} label="Confirmar" primary />;
  return (
    <form action={run} className="stl-inline">
      <input type="hidden" name="company" value={pdf.company} />
      <input type="hidden" name="boxful_id" value={pdf.id} />
      <input type="hidden" name="boxful_version" value={pdf.version} />
      <input type="hidden" name="mercury_id" value={m.id} />
      <input type="hidden" name="mercury_version" value={m.version} />
      <input type="hidden" name="fee" value="0.00" />
      <input type="hidden" name="fee_note" value="" />
      <input type="hidden" name="confirmed" value="on" />
      <SubmitButton className="btn btn-primary btn-sm" pending="Confirmando…">Confirmar</SubmitButton>
      <Msg state={state} />
    </form>
  );
}

function PickPdfSheet({ v, loose, label }: { v: SettlementView; loose: BankEntry[]; label: string }) {
  return (
    <SideSheet trigger={label} triggerClass="btn btn-sm" title="Elegir el comprobante" sub={`${v.s.reference} · ${money(v.s.amount_cents, v.s.currency)}${v.expectedUsd ? ` · ≈ ${usd(v.expectedUsd)}` : ""}`}>
      <PickPdf v={v} loose={loose} />
    </SideSheet>
  );
}

function PickPdf({ v, loose }: { v: SettlementView; loose: BankEntry[] }) {
  const [state, run] = useActionState(linkSettlementPdf, null);
  useCloseOnOk(state);
  const [all, setAll] = useState(false);
  const suggested = new Set(v.pdfOptions.map((c) => c.entry.id));
  // los demás: primero los de la misma operación y país, y los de monto más cercano
  const fits = (e: BankEntry) => (!e.origin_operation || e.origin_operation === v.s.operation) && (!e.origin_country || e.origin_country === v.s.country);
  const gap = (e: BankEntry) => (v.expectedUsd === null ? 0 : Math.abs(e.amount_cents - v.expectedUsd));
  const rest = loose
    .filter((e) => !suggested.has(e.id) && e.company === v.s.company)
    .sort((a, b) => Number(fits(b)) - Number(fits(a)) || gap(a) - gap(b));
  const list: { e: BankEntry; reason: string }[] = [
    ...v.pdfOptions.map((c) => ({ e: c.entry, reason: c.reason })),
    ...(all || !v.pdfOptions.length ? rest.map((e) => ({ e, reason: "" })) : []),
  ];
  return (
    <form action={run} className="bank-form stl-pick">
      <input type="hidden" name="settlement_id" value={v.s.id} />
      <input type="hidden" name="company" value={v.s.company} />
      {list.length ? (
        <fieldset>
          <legend className="sr-only">Comprobantes</legend>
          {list.map(({ e, reason }, i) => (
            <label key={e.id} className="stl-option">
              {/* solo se marca sola la sugerencia; si no hay, elige la persona */}
              <input type="radio" name="boxful_id" value={e.id} defaultChecked={i === 0 && !!reason} required />
              <span>
                <strong>{usd(e.amount_cents)}</strong> · {e.reference} · {shortDay(e.occurred_on)}
                <small>
                  {[reason, originLabel(e.origin_operation, e.origin_country), v.expectedUsd !== null ? `${signedUsd(e.amount_cents - v.expectedUsd)} vs. lo esperado` : ""].filter(Boolean).join(" · ")}
                </small>
              </span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="muted">No hay comprobantes sueltos. Usa «Subir PDF».</p>
      )}
      {!all && v.pdfOptions.length > 0 && rest.length > 0 && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(true)}>Ver los otros {rest.length} comprobantes sin liquidación</button>
      )}
      <Msg state={state} />
      {list.length > 0 && <SubmitButton className="btn btn-primary" pending="Vinculando…">Vincular comprobante</SubmitButton>}
    </form>
  );
}

function PickMercurySheet({ pdf, options, label, primary }: { pdf: BankEntry; options: Candidate[]; label: string; primary?: boolean }) {
  return (
    <SideSheet trigger={label} triggerClass={primary ? "btn btn-primary btn-sm" : "btn btn-sm"} title="Abono en Mercury" sub={`Comprobante ${pdf.reference} · ${usd(pdf.amount_cents)}`}>
      <PickMercury pdf={pdf} options={options} />
    </SideSheet>
  );
}

function PickMercury({ pdf, options }: { pdf: BankEntry; options: Candidate[] }) {
  const [state, run] = useActionState(reconcileBank, null);
  useCloseOnOk(state);
  const [selected, setSelected] = useState(options[0]?.entry.id ?? "");
  const m = options.find((c) => c.entry.id === selected)?.entry;
  const fee = m ? pdf.amount_cents - m.amount_cents : 0;
  return (
    <form action={run} className="bank-form stl-pick">
      <input type="hidden" name="company" value={pdf.company} />
      <input type="hidden" name="boxful_id" value={pdf.id} />
      <input type="hidden" name="boxful_version" value={pdf.version} />
      <input type="hidden" name="mercury_id" value={m?.id ?? ""} />
      <input type="hidden" name="mercury_version" value={m?.version ?? ""} />
      <input type="hidden" name="fee" value={(Math.max(fee, 0) / 100).toFixed(2)} />
      <fieldset>
        <legend className="sr-only">Abonos</legend>
        {options.map((c) => (
          <label key={c.entry.id} className="stl-option">
            <input type="radio" name="pick" checked={selected === c.entry.id} onChange={() => setSelected(c.entry.id)} />
            <span>
              <strong>{usd(c.entry.amount_cents)}</strong> · {shortDay(c.entry.occurred_on)} · {c.entry.reference}
              <small>{c.entry.counterparty} · {c.entry.bank_account}{c.diffCents ? ` · comisión ${usd(Math.abs(c.diffCents))}` : ""}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {fee < 0 && <p className="banner" data-tone="warning">El abono es mayor que lo enviado: no cuadra. Revisa en Movimientos.</p>}
      {fee > 0 && (
        <label className="field">
          <span>Comisión de {usd(fee)}: ¿de qué es?</span>
          <input className="input" name="fee_note" required maxLength={1000} placeholder="Ej.: comisión del banco intermediario" />
        </label>
      )}
      {fee === 0 && <input type="hidden" name="fee_note" value="" />}
      <label className="bank-confirm">
        <input type="checkbox" name="confirmed" required />
        <span>Verifiqué que este abono es el de este comprobante.</span>
      </label>
      <Msg state={state} />
      <SubmitButton className="btn btn-primary" pending="Confirmando…" disabled={!m || fee < 0}>Confirmar abono</SubmitButton>
    </form>
  );
}

function Detail({ v, company, names, byId }: { v: SettlementView; company: Company; names: Record<string, string>; byId: Map<string, BankEntry> }) {
  const { s } = v;
  const rows: [string, string][] = [
    [s.source === "boxful" ? "Números de confirmación" : "Código en Drop", s.reference],
    ["Número de confirmación", s.confirmation || "—"],
    [`Estado en ${platform(s)}`, s.status_label + (s.failure_reason ? ` · ${s.failure_reason}` : "")],
    ["Pedida", s.requested_on],
    ["Monto", money(s.amount_cents, s.currency)],
    ...(s.usd_rate && s.currency !== "USD" ? [[`Tasa de ${platform(s)}`, `1 ${s.currency} = ${s.usd_rate} USD`] as [string, string]] : []),
    ...(v.expectedUsd !== null ? [[s.usd_amount_cents ? "Enviado en USD" : "Esperado en USD", usd(v.expectedUsd)] as [string, string]] : []),
    ["Banco de destino", [s.bank, s.bank_account].filter(Boolean).join(" · ") || "—"],
  ];
  if (s.linked_by) rows.push(["Comprobante vinculado por", `${names[s.linked_by] ?? "Usuario"} · ${s.linked_at?.slice(0, 10) ?? ""}`]);
  if (s.reviewed_by) rows.push(["Revisada por", `${names[s.reviewed_by] ?? "Usuario"} · ${s.review_note ?? ""}`]);
  return (
    <div className="bank-form">
      <dl className="bank-audit-data">
        {rows.map(([k, val]) => (
          <div key={k}><dt>{k}</dt><dd>{val}</dd></div>
        ))}
      </dl>
      {s.evidence.length > 0 && (
        <p>{s.evidence.map((u, i) => <a key={u} className="btn" href={u} target="_blank" rel="noreferrer">Comprobante de {platform(s)} {s.evidence.length > 1 ? i + 1 : ""} ↗</a>)}</p>
      )}
      {v.step === "review" && <ReviewForm s={s} />}
      {v.pdf && <UnlinkForm s={s} pdf={v.pdf} company={company} matched={!!v.match} />}
      {!v.pdf && s.boxful_id && byId.get(s.boxful_id)?.void_reason && (
        <p className="banner" data-tone="warning">El comprobante que tenía vinculado se anuló. Elige o sube otro.</p>
      )}
    </div>
  );
}

function ReviewForm({ s }: { s: Settlement }) {
  const [state, run] = useActionState(reviewSettlement, null);
  useCloseOnOk(state);
  return (
    <form action={run} className="stl-sub">
      <h3>Marcar como revisada</h3>
      <input type="hidden" name="settlement_id" value={s.id} />
      <input type="hidden" name="company" value={s.company} />
      <label className="field">
        <span>¿Qué pasó?</span>
        <textarea className="input" name="note" rows={2} required minLength={3} maxLength={500} placeholder="Ej.: la rechazaron por la cuenta; se volvió a pedir como QB65AIKE" />
      </label>
      <Msg state={state} />
      <SubmitButton className="btn" pending="Guardando…">Marcar revisada</SubmitButton>
    </form>
  );
}

function UnlinkForm({ s, pdf, company, matched }: { s: Settlement; pdf: BankEntry; company: Company; matched: boolean }) {
  const [state, run] = useActionState(unlinkSettlementPdf, null);
  useCloseOnOk(state);
  return (
    <details className="bank-void">
      <summary>Desvincular el comprobante</summary>
      <form action={run} className="stl-sub">
        <input type="hidden" name="settlement_id" value={s.id} />
        <input type="hidden" name="company" value={company} />
        <input type="hidden" name="boxful_id" value={pdf.id} />
        <p className="hint">
          {pdf.reference} · {usd(pdf.amount_cents)} vuelve a quedar suelto.
          {matched ? " Su cruce con Mercury se mantiene; si también está mal, reviértelo en Movimientos." : ""}
        </p>
        <Msg state={state} />
        <SubmitButton className="btn" pending="Desvinculando…">Desvincular</SubmitButton>
      </form>
    </details>
  );
}

/** Comprobantes que no están en ninguna liquidación, y los marcados "no es liquidación". */
function LooseBox({ company, loose, exempt, byId, needsPdf, names }: {
  company: Company; loose: BankEntry[]; exempt: SettlementExempt[]; byId: Map<string, BankEntry>; needsPdf: SettlementView[]; names: Record<string, string>;
}) {
  if (!loose.length && !exempt.length) return null;
  return (
    <details className="stl-loose">
      <summary>
        Comprobantes sin liquidación <span className="tag">{loose.length}</span>
        {exempt.length > 0 && <span className="muted"> · {exempt.length} marcados «no es liquidación»</span>}
      </summary>
      <p className="hint">PDF de Boxful que no están en ninguna liquidación. Vincúlalos, o márcalos si no son una liquidación (por ejemplo, un pago de bodega).</p>
      <ul className="stl-loose-list">
        {loose.map((e) => (
          <li key={e.id}>
            <span>
              <strong>{usd(e.amount_cents)}</strong> · {e.reference} · {shortDay(e.occurred_on)}
              <small>{originLabel(e.origin_operation, e.origin_country) ?? "Operación sin indicar"}</small>
            </span>
            <span className="stl-actions">
              {needsPdf.length > 0 && (
                <SideSheet trigger="Vincular a…" triggerClass="btn btn-sm" title="¿De qué liquidación es?" sub={`${e.reference} · ${usd(e.amount_cents)}`}>
                  <PickSettlement entry={e} needsPdf={needsPdf} />
                </SideSheet>
              )}
              <SideSheet trigger="No es liquidación" triggerClass="btn btn-ghost btn-sm" title="No es una liquidación" sub={`${e.reference} · ${usd(e.amount_cents)}`}>
                <ExemptForm entry={e} company={company} />
              </SideSheet>
            </span>
          </li>
        ))}
      </ul>
      {exempt.length > 0 && (
        <>
          <h3 className="stl-sub-title">Marcados «no es liquidación»</h3>
          <ul className="stl-loose-list">
            {exempt.map((x) => {
              const e = byId.get(x.entry_id);
              return (
                <li key={x.id}>
                  <span>
                    <strong>{e ? usd(e.amount_cents) : "—"}</strong> · {e?.reference ?? "Comprobante"}
                    <small>{x.reason} · {names[x.created_by] ?? "Usuario"}</small>
                  </span>
                  <UnexemptForm id={x.id} company={company} />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </details>
  );
}

function PickSettlement({ entry, needsPdf }: { entry: BankEntry; needsPdf: SettlementView[] }) {
  const [state, run] = useActionState(linkSettlementPdf, null);
  useCloseOnOk(state);
  // primero aquellas para las que este comprobante es una sugerencia
  const sorted = [...needsPdf].sort((a, b) => {
    const ra = a.pdfOptions.findIndex((c) => c.entry.id === entry.id), rb = b.pdfOptions.findIndex((c) => c.entry.id === entry.id);
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || b.s.requested_at.localeCompare(a.s.requested_at);
  }).filter((v) => v.s.company === entry.company);
  const [selected, setSelected] = useState(sorted[0]?.pdfOptions.some((c) => c.entry.id === entry.id) ? sorted[0].s.id : "");
  return (
    <form action={run} className="bank-form stl-pick">
      <input type="hidden" name="company" value={entry.company} />
      <input type="hidden" name="boxful_id" value={entry.id} />
      <input type="hidden" name="settlement_id" value={selected} />
      <fieldset>
        <legend className="sr-only">Liquidaciones sin comprobante</legend>
        {sorted.map((v) => {
          const hit = v.pdfOptions.find((c) => c.entry.id === entry.id);
          return (
            <label key={v.s.id} className="stl-option">
              <input type="radio" name="pick" checked={selected === v.s.id} onChange={() => setSelected(v.s.id)} />
              <span>
                <strong>{v.s.reference}</strong> · {money(v.s.amount_cents, v.s.currency)} · {shortDay(v.s.requested_on)}
                <small>
                  {[originLabel(v.s.operation, v.s.country), v.expectedUsd !== null ? `≈ ${usd(v.expectedUsd)}` : "", hit?.reason ?? ""].filter(Boolean).join(" · ")}
                </small>
              </span>
            </label>
          );
        })}
      </fieldset>
      <Msg state={state} />
      <SubmitButton className="btn btn-primary" pending="Vinculando…" disabled={!selected}>Vincular</SubmitButton>
    </form>
  );
}

function ExemptForm({ entry, company }: { entry: BankEntry; company: Company }) {
  const [state, run] = useActionState(exemptBankEntry, null);
  useCloseOnOk(state);
  return (
    <form action={run} className="bank-form">
      <input type="hidden" name="entry_id" value={entry.id} />
      <input type="hidden" name="company" value={company} />
      <label className="field">
        <span>¿Qué es?</span>
        <input className="input" name="reason" required minLength={3} maxLength={300} placeholder="Ej.: pago de bodega El Salvador" defaultValue={entry.notes.slice(0, 120)} />
      </label>
      <p className="hint">Deja de sugerirse como liquidación. Se puede deshacer y queda en la actividad.</p>
      <Msg state={state} />
      <SubmitButton className="btn btn-primary" pending="Guardando…">Marcar</SubmitButton>
    </form>
  );
}

function UnexemptForm({ id, company }: { id: string; company: Company }) {
  const [state, run] = useActionState(unexemptBankEntry, null);
  return (
    <form action={run} className="stl-inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="company" value={company} />
      <SubmitButton className="btn btn-ghost btn-sm" pending="Quitando…">Quitar marca</SubmitButton>
      <Msg state={state} />
    </form>
  );
}
