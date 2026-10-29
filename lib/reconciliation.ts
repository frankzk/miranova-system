// Dinero en centavos enteros. Nunca redondear una diferencia para darla por conciliada.
export const COMPANIES = [
  { id: "miranova", label: "Miranova" },
  { id: "mireva", label: "Mireva" },
] as const;
export type Company = (typeof COMPANIES)[number]["id"];
export type EntrySource = "boxful" | "mercury";
export const ORIGINAL_CURRENCIES = [
  "USD",
  "HNL",
  "GTQ",
  "MXN",
  "CRC",
  "NIO",
  "COP",
  "EUR",
] as const;
export const BANK_BUCKET = "bank-documents";
export const MAX_BANK_PDF = 15 * 1024 * 1024;
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isCompany = (s: unknown): s is Company =>
  COMPANIES.some((c) => c.id === s);
export const isSource = (s: unknown): s is EntrySource =>
  s === "boxful" || s === "mercury";

export type BankEntry = {
  id: string;
  company: Company;
  source: EntrySource;
  reference: string;
  occurred_on: string;
  amount_cents: number;
  original_currency: string;
  original_amount_cents: number;
  counterparty: string;
  bank_account: string;
  notes: string;
  document_path: string | null;
  document_name: string | null;
  document_sha256: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  version: number;
  void_reason: string | null;
};
export type BankMatch = {
  id: string;
  company: Company;
  boxful_id: string;
  mercury_id: string;
  boxful_version: number;
  mercury_version: number;
  fee_cents: number;
  fee_note: string;
  boxful_snapshot: BankEntry;
  mercury_snapshot: BankEntry;
  created_by: string;
  created_at: string;
  reversed_at: string | null;
  reversed_by: string | null;
  reversal_reason: string | null;
};
export type BankAudit = {
  id: string;
  company: Company;
  entity_id: string;
  entity_type: string;
  operation: string;
  actor_id: string;
  created_at: string;
  snapshot: Record<string, unknown>;
};
export type BankFields = Pick<
  BankEntry,
  | "company"
  | "source"
  | "reference"
  | "occurred_on"
  | "amount_cents"
  | "original_currency"
  | "original_amount_cents"
  | "counterparty"
  | "bank_account"
  | "notes"
>;
export type BankState = { ok: boolean; msg: string } | null;

/** Acepta punto decimal, sin separadores ambiguos ni notación científica. */
export function cents(value: string): number | null {
  const s = value.trim();
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, fraction = ""] = s.split(".");
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(n) && n <= 999_999_999_999 ? n : null;
}
export const decimal = (n: number) => (n / 100).toFixed(2);
export const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n / 100,
  );
export const referenceKey = (s: string) =>
  s.trim().replace(/\s+/g, " ").toLowerCase();

export function validBankDay(day: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(day)) &&
    new Date(day).toISOString().slice(0, 10) === day
  );
}

export function cleanBankFields(
  input: Record<string, string>,
): { ok: true; row: BankFields } | { ok: false; msg: string } {
  const { company, source, occurred_on } = input;
  if (!isCompany(company) || !isSource(source))
    return { ok: false, msg: "Selecciona una empresa y un origen válidos." };
  const reference = (input.reference ?? "").trim().replace(/\s+/g, " ");
  if (!reference || reference.length > 160)
    return {
      ok: false,
      msg: "Escribe la referencia única de la transacción (hasta 160 caracteres).",
    };
  if (!validBankDay(occurred_on))
    return { ok: false, msg: "La fecha no es válida." };
  const amount_cents = cents(input.amount ?? "");
  if (amount_cents === null || amount_cents <= 0)
    return {
      ok: false,
      msg: "El importe USD debe ser positivo y tener como máximo dos decimales. Usa punto decimal y no incluyas comas.",
    };
  const original_currency =
    source === "mercury" ? "USD" : input.original_currency || "USD";
  if (!(ORIGINAL_CURRENCIES as readonly string[]).includes(original_currency))
    return { ok: false, msg: "Moneda original no válida." };
  const original_amount_cents =
    original_currency === "USD"
      ? amount_cents
      : cents(input.original_amount ?? "");
  if (original_amount_cents === null || original_amount_cents <= 0)
    return {
      ok: false,
      msg: "Registra también el monto original del PDF en su moneda.",
    };
  const counterparty = (input.counterparty ?? "").trim();
  const bank_account = (input.bank_account ?? "").trim();
  const notes = (input.notes ?? "").trim();
  if (
    counterparty.length > 200 ||
    bank_account.length > 100 ||
    notes.length > 2000
  )
    return {
      ok: false,
      msg: "El remitente, la cuenta o las notas superan el largo permitido.",
    };
  if (source === "mercury" && (!counterparty || !bank_account))
    return {
      ok: false,
      msg: "Indica el remitente y la cuenta Mercury que recibió el abono.",
    };
  return {
    ok: true,
    row: {
      company,
      source,
      reference,
      occurred_on,
      amount_cents,
      original_currency,
      original_amount_cents,
      counterparty,
      bank_account,
      notes,
    },
  };
}

export function matchProblem(
  boxful: BankEntry,
  mercury: BankEntry,
  fee: number,
  feeNote: string,
): string | null {
  if (boxful.source !== "boxful" || mercury.source !== "mercury")
    return "Elige una liquidación Boxful y un abono Mercury.";
  if (boxful.company !== mercury.company)
    return "No se pueden cruzar empresas distintas.";
  if (boxful.void_reason || mercury.void_reason)
    return "Un movimiento anulado no se puede conciliar.";
  if (!Number.isSafeInteger(fee) || fee < 0)
    return "La comisión debe ser un monto positivo o cero.";
  if (boxful.amount_cents - mercury.amount_cents !== fee)
    return "No cuadra: Boxful USD debe ser igual al abono Mercury más la comisión.";
  if (fee > 0 && !feeNote.trim())
    return "Explica la comisión y su comprobante antes de confirmar.";
  return null;
}

/** Ordena candidatos, nunca concilia automáticamente ni descarta diferencias grandes. */
export function bankCandidates(
  anchor: BankEntry,
  entries: BankEntry[],
  matches: BankMatch[],
): BankEntry[] {
  const used = new Set(
    matches
      .filter((m) => !m.reversed_at)
      .map((m) => (anchor.source === "mercury" ? m.boxful_id : m.mercury_id)),
  );
  return entries
    .filter(
      (e) =>
        e.company === anchor.company &&
        e.source === (anchor.source === "mercury" ? "boxful" : "mercury") &&
        !anchor.void_reason &&
        !e.void_reason &&
        !used.has(e.id),
    )
    .sort((a, b) => {
      const exactA = a.amount_cents === anchor.amount_cents ? 0 : 1;
      const exactB = b.amount_cents === anchor.amount_cents ? 0 : 1;
      return (
        exactA - exactB ||
        Math.abs(a.amount_cents - anchor.amount_cents) -
          Math.abs(b.amount_cents - anchor.amount_cents) ||
        Math.abs(Date.parse(a.occurred_on) - Date.parse(anchor.occurred_on)) -
          Math.abs(Date.parse(b.occurred_on) - Date.parse(anchor.occurred_on))
      );
    });
}
