// Conciliación en 3 pasos de cada liquidación: ① la registra Drop (o Boxful) → ② llega el comprobante
// (PDF de la transferencia, un movimiento "boxful" de bank_entries) → ③ entra la plata a Mercury (el
// cruce boxful↔mercury de bank_matches). Aquí solo se proponen parejas: siempre confirma una persona.
// Sin base de datos, para probarlo.

import { bankCandidates, referenceKey, type BankEntry, type BankMatch, type Company } from "./reconciliation.ts";

export type SettlementStatus = "pending" | "paid" | "rejected";

export type Settlement = {
  id: string;
  company: Company;
  source: "drop" | "boxful";
  account_id: string | null;
  external_id: string;
  reference: string;
  /** número de confirmación de la transferencia (la referencia del PDF de Boxful/BAC) */
  confirmation: string;
  /** de qué operación y país (lib/bank-origin.ts) */
  operation: string | null;
  country: string | null;
  requested_at: string;
  /** el día en el país de la cuenta */
  requested_on: string;
  status: SettlementStatus;
  /** como lo muestra la plataforma ("Liquidada", "Rechazada"…) */
  status_label: string;
  failure_reason: string;
  currency: string;
  amount_cents: number;
  /** USD por unidad de la moneda, según la plataforma */
  usd_rate: number | null;
  /** lo enviado en USD, si la plataforma lo informa */
  usd_amount_cents: number | null;
  bank: string;
  bank_account: string;
  /** comprobantes que adjunta la plataforma (enlaces) */
  evidence: string[];
  boxful_id: string | null;
  linked_by: string | null;
  linked_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
};

const DAY = 86_400_000;
const day = (s: string) => Date.parse(s.slice(0, 10));
const requestedDay = (s: Settlement) => day(s.requested_on || s.requested_at);

/** Lo que debería llegar en USD: lo que informa la plataforma o, si no, con su tasa; null si no hay tasa. */
export function expectedUsdCents(s: Pick<Settlement, "currency" | "amount_cents" | "usd_rate"> & { usd_amount_cents?: number | null }): number | null {
  if (s.usd_amount_cents) return s.usd_amount_cents;
  if (s.currency === "USD") return s.amount_cents;
  return s.usd_rate && s.usd_rate > 0 ? Math.round(s.amount_cents * s.usd_rate) : null;
}

/** Partes de una referencia: "2352476-2353166-2352659" → cada número; "ILGA5JTC" → sí misma. */
export function referenceParts(ref: string): string[] {
  return [...new Set(ref.split(/[\s,;/|-]+/).map(referenceKey).filter((p) => p.length >= 5))];
}

/** El comprobante menciona la liquidación (su código o su número de confirmación), o su referencia es una de ellas. */
export function referenceMatches(s: Pick<Settlement, "reference"> & { confirmation?: string }, e: Pick<BankEntry, "reference" | "notes" | "document_name">): boolean {
  const parts = referenceParts(`${s.reference} ${s.confirmation ?? ""}`);
  if (!parts.length) return false;
  const own = referenceKey(e.reference);
  if (parts.includes(own)) return true;
  const text = ` ${referenceKey([e.reference, e.notes, e.document_name ?? ""].join(" "))} `;
  return parts.some((p) => new RegExp(`(^|[^a-z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(text));
}

export type Candidate = { entry: BankEntry; strong: boolean; reason: string; diffCents: number | null };

/** Tolerancia para "el monto se parece": la tasa del día y comisiones bancarias mueven unos puntos. */
const CLOSE = 0.03;
const STRONG = 0.015;

/**
 * Comprobantes (PDF de Boxful) que pueden ser de esta liquidación. Fuera los de otra empresa, otra
 * operación o país ya indicados, anulados o ya usados en otra liquidación.
 */
export function pdfCandidates(s: Settlement, entries: BankEntry[], used: Set<string>): Candidate[] {
  const expected = expectedUsdCents(s);
  const requested = requestedDay(s);
  const out: Candidate[] = [];
  for (const e of entries) {
    if (e.source !== "boxful" || e.company !== s.company || e.void_reason || (used.has(e.id) && e.id !== s.boxful_id)) continue;
    if (s.operation && e.origin_operation && e.origin_operation !== s.operation) continue;
    if (s.country && e.origin_country && e.origin_country !== s.country) continue;
    const refOk = referenceMatches(s, e);
    const sameOriginal = e.original_currency === s.currency && e.original_amount_cents === s.amount_cents;
    const diffCents = expected === null ? null : e.amount_cents - expected;
    const ratio = expected ? Math.abs(e.amount_cents - expected) / expected : Infinity;
    const days = (day(e.occurred_on) - requested) / DAY;
    const inWindow = days >= -3 && days <= 21;
    if (refOk) out.push({ entry: e, strong: true, reason: "La referencia está en esta liquidación", diffCents });
    else if (sameOriginal && inWindow) out.push({ entry: e, strong: true, reason: "Mismo monto en " + s.currency, diffCents });
    else if (ratio <= CLOSE && inWindow) out.push({ entry: e, strong: ratio <= STRONG && days >= -1 && days <= 7, reason: "Monto y fecha parecidos", diffCents });
  }
  const rank = (c: Candidate) => (c.strong ? 0 : 1);
  out.sort((a, b) => rank(a) - rank(b) || Math.abs(a.diffCents ?? 0) - Math.abs(b.diffCents ?? 0));
  // una sugerencia "fuerte" solo si es la única fuerte; si hay varias, que elija la persona
  if (out.filter((c) => c.strong).length > 1) for (const c of out) if (c.reason === "Monto y fecha parecidos") c.strong = false;
  return out.slice(0, 6);
}

/** Abonos de Mercury para el comprobante ya vinculado: los de siempre, con el mismo monto y fecha cercana como "fuerte". */
export function mercuryCandidates(pdf: BankEntry, entries: BankEntry[], matches: BankMatch[]): Candidate[] {
  const list = bankCandidates(pdf, entries, matches).slice(0, 6);
  const exact = list.filter((m) => m.amount_cents === pdf.amount_cents && Math.abs(day(m.occurred_on) - day(pdf.occurred_on)) <= 7 * DAY);
  return list.map((m) => ({
    entry: m,
    strong: exact.length === 1 && exact[0].id === m.id,
    reason: m.amount_cents === pdf.amount_cents ? "Mismo monto" : "Monto parecido",
    diffCents: pdf.amount_cents - m.amount_cents,
  }));
}

export type Step =
  | "review" // rechazada en la plataforma, sin revisar
  | "reviewed" // rechazada y revisada
  | "waiting_platform" // pedida, la plataforma todavía no la paga
  | "needs_pdf"
  | "confirm_pdf"
  | "waiting_mercury"
  | "confirm_mercury"
  | "closed";

export type SettlementView = {
  s: Settlement;
  step: Step;
  expectedUsd: number | null;
  pdf: BankEntry | null;
  pdfOptions: Candidate[];
  match: BankMatch | null;
  mercury: BankEntry | null;
  mercuryOptions: Candidate[];
};

/** En qué paso va cada liquidación y qué parejas se proponen. */
export function settlementViews(settlements: Settlement[], entries: BankEntry[], matches: BankMatch[], exempt: Set<string> = new Set()): SettlementView[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  // los ya vinculados y los que no son liquidación no se proponen
  const used = new Set([...settlements.map((s) => s.boxful_id).filter((id): id is string => !!id), ...exempt]);
  const active = matches.filter((m) => !m.reversed_at);
  return settlements.map((s) => {
    const expectedUsd = expectedUsdCents(s);
    const base = { s, expectedUsd, pdf: null, pdfOptions: [], match: null, mercury: null, mercuryOptions: [] };
    if (s.status === "rejected") return { ...base, step: s.reviewed_at ? "reviewed" : "review" };
    const pdf = s.boxful_id ? byId.get(s.boxful_id) ?? null : null;
    if (!pdf || pdf.void_reason) {
      const pdfOptions = pdfCandidates(s, entries, used);
      if (s.status === "pending" && !pdfOptions.some((c) => c.strong)) return { ...base, pdfOptions, step: "waiting_platform" };
      return { ...base, pdfOptions, step: pdfOptions.some((c) => c.strong) ? "confirm_pdf" : "needs_pdf" };
    }
    const match = active.find((m) => m.boxful_id === pdf.id) ?? null;
    if (match) return { ...base, pdf, match, mercury: byId.get(match.mercury_id) ?? match.mercury_snapshot, step: "closed" };
    const mercuryOptions = mercuryCandidates(pdf, entries, matches);
    return { ...base, pdf, mercuryOptions, step: mercuryOptions.some((c) => c.strong) ? "confirm_mercury" : "waiting_mercury" };
  });
}

/** Comprobantes de Boxful que no están en ninguna liquidación (ni anulados, ni marcados "no es liquidación"). */
export function loosePdfs(settlements: Settlement[], entries: BankEntry[], exempt: Set<string> = new Set()): BankEntry[] {
  const used = new Set(settlements.map((s) => s.boxful_id));
  return entries.filter((e) => e.source === "boxful" && !e.void_reason && !used.has(e.id) && !exempt.has(e.id));
}

const SYMBOL: Record<string, string> = { USD: "US$", HNL: "L", GTQ: "Q", CRC: "₡", NIO: "C$", MXN: "MX$", COP: "COL$", EUR: "€" };

/** "L 363,000.00", "US$ 14,085.49": el monto en su moneda, como lo muestran Drop y los bancos. */
export function money(centsValue: number, currency: string): string {
  const n = (centsValue / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${SYMBOL[currency] ?? currency} ${n}`;
}

/** Diferencia con signo: "−US$ 20.00", "+US$ 1.50". */
export function signedUsd(centsValue: number): string {
  return (centsValue < 0 ? "−" : "+") + money(Math.abs(centsValue), "USD");
}

/** Días entre dos fechas YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY);
}

/** Para los contadores y filtros de arriba. */
export const STEP_GROUP: Record<Step, "pdf" | "confirm" | "waiting" | "review" | "done"> = {
  needs_pdf: "pdf",
  confirm_pdf: "confirm",
  confirm_mercury: "confirm",
  waiting_platform: "waiting",
  waiting_mercury: "waiting",
  review: "review",
  reviewed: "done",
  closed: "done",
};
