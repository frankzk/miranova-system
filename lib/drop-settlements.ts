// Liquidaciones de Drop: lo que el proveedor pide retirar de su billetera y Drop le transfiere (por Boxful)
// a Mercury. Drop no tiene una ruta de liquidaciones: cada una llega dentro de los movimientos de la
// billetera ("/balance-movements", del más nuevo al más viejo) como "Descuento por liquidación"
// (requestType settlement_debit), con la solicitud completa en `settlement` y la tasa de cambio del día:
//   settlement: { id, requestCode: "ILGA5JTC", createdAt, status: "settled", amount: 363000,
//                 confirmationNumber: "2355766", bankName, bankAccountNumber, usdAmount, settlementFailureReason… }
// confirmationNumber es la referencia de la transferencia (la del PDF de Boxful/BAC). Sin base de datos, para probarlo.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** La lista de movimientos de una página de la billetera (data.movements u otra lista conocida). */
export function movementList(json: unknown): Obj[] {
  const find = (node: unknown, depth: number): unknown[] | null => {
    if (Array.isArray(node)) return node;
    if (!isObj(node) || depth > 3) return null;
    for (const [k, v] of Object.entries(node)) if (/^(movements|items|results|docs|rows|records|data)$/i.test(k) && Array.isArray(v)) return v;
    for (const v of Object.values(node)) {
      const r = find(v, depth + 1);
      if (r) return r;
    }
    return null;
  };
  return (find(json, 0) ?? []).filter(isObj);
}

/** Total de movimientos que informa la página (data.total), si lo trae. */
export function movementTotal(json: unknown): number | null {
  const data = isObj(json) && isObj(json.data) ? json.data : json;
  return isObj(data) && typeof data.total === "number" ? data.total : null;
}

/** Nombre del tipo de movimiento ("settlement_credit", "settlement_debit"…). */
export function movementType(m: Obj): string {
  const t = m.requestType ?? m.kind;
  if (isObj(t)) return String(t.name ?? t.label ?? "sin_tipo");
  return typeof t === "string" && t ? t : "sin_tipo";
}

export type DropStatus = "pending" | "paid" | "rejected";

/** Estado de Drop → el nuestro, con el texto que se muestra. */
export function settlementStatus(raw: unknown): { status: DropStatus; label: string } {
  const s = String(raw ?? "").trim().toLowerCase();
  if (/^(settled|paid|completed?|done|liquidated)$/.test(s)) return { status: "paid", label: "Liquidada" };
  if (/^(rejected|declined|denied)$/.test(s)) return { status: "rejected", label: "Rechazada" };
  if (/^(failed|failure|error)$/.test(s)) return { status: "rejected", label: "Fallida" };
  if (/^(cancell?ed|voided)$/.test(s)) return { status: "rejected", label: "Cancelada" };
  if (/^(reversed|returned|refunded)$/.test(s)) return { status: "rejected", label: "Revertida" };
  if (/^(processing|in_?progress|approved|sent|in_?transit)$/.test(s)) return { status: "pending", label: "En proceso" };
  return { status: "pending", label: s ? (s === "pending" || s === "requested" || s === "created" ? "Pendiente" : s) : "Pendiente" };
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const text = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");

/** "202460420277" → "••0277": la cuenta de destino sin el número completo. */
export function maskAccount(v: unknown): string {
  const digits = text(v).replace(/\s+/g, "");
  return digits.length > 4 ? "••" + digits.slice(-4) : digits;
}

/** Enlaces de comprobantes que adjunte Drop (strings o { url }). */
function evidenceUrls(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x : isObj(x) ? text(x.url ?? x.fileUrl ?? x.link ?? x.href, 1000) : ""))
    .filter((u) => /^https:\/\//i.test(u))
    .slice(0, 10);
}

export type DropSettlement = {
  external_id: string;
  reference: string;
  confirmation: string;
  requested_at: string;
  status: DropStatus;
  status_label: string;
  failure_reason: string;
  amount_cents: number;
  usd_rate: number | null;
  usd_amount_cents: number | null;
  bank: string;
  bank_account: string;
  evidence: string[];
  /** lo de la solicitud que sirve para revisar (sin correos ni direcciones) */
  raw: Obj;
};

const RAW_KEYS = [
  "id", "requestCode", "createdAt", "updatedAt", "type", "amount", "transferredAmount", "usdAmount", "status",
  "networkType", "bankName", "confirmationNumber", "transactionId", "settlementFailureReason", "settlementFailedAt",
];

/** La liquidación que viene en un movimiento de la billetera, o null si el movimiento no es de una. */
export function settlementFromMovement(m: Obj): DropSettlement | null {
  const s = m.settlement;
  if (!isObj(s)) return null;
  const id = text(s.id ?? m.settlementId);
  const createdAt = text(s.createdAt ?? m.createdAt);
  const amount = num(s.amount) ?? num(m.amount);
  if (!id || !createdAt || !Number.isFinite(Date.parse(createdAt)) || amount === null || amount <= 0) return null;
  const rate = isObj(m.exchangeRate) ? num(m.exchangeRate.rate) : null;
  const usd = num(s.usdAmount);
  const { status, label } = settlementStatus(s.status);
  const raw: Obj = Object.fromEntries(RAW_KEYS.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]));
  if (isObj(m.exchangeRate)) raw.exchangeRate = m.exchangeRate;
  raw.movementType = movementType(m);
  return {
    external_id: id,
    reference: text(s.requestCode, 100) || id,
    confirmation: text(s.confirmationNumber, 100),
    requested_at: new Date(createdAt).toISOString(),
    status,
    status_label: label,
    failure_reason: text(s.settlementFailureReason, 300),
    amount_cents: Math.round(amount * 100),
    usd_rate: rate && rate > 0 ? rate : null,
    usd_amount_cents: usd && usd > 0 ? Math.round(usd * 100) : null,
    bank: text(s.bankName),
    bank_account: maskAccount(s.bankAccountNumber),
    evidence: [...evidenceUrls(m.evidence), ...evidenceUrls(s.evidence)],
    raw,
  };
}

/**
 * Las liquidaciones de una página de movimientos, sin repetir (una misma solicitud puede venir en el
 * descuento y, si la rechazan, en su devolución: gana el descuento, que trae la tasa del día).
 */
export function settlementsFromPage(json: unknown): DropSettlement[] {
  const out = new Map<string, DropSettlement>();
  for (const m of movementList(json)) {
    const s = settlementFromMovement(m);
    if (!s) continue;
    const prev = out.get(s.external_id);
    if (!prev || (prev.raw.movementType !== "settlement_debit" && s.raw.movementType === "settlement_debit")) out.set(s.external_id, s);
  }
  return [...out.values()];
}

/** Fecha del movimiento más viejo de la página (vienen del más nuevo al más viejo). */
export function oldestMovementAt(json: unknown): number | null {
  let min: number | null = null;
  for (const m of movementList(json)) {
    const t = Date.parse(text(m.createdAt));
    if (Number.isFinite(t) && (min === null || t < min)) min = t;
  }
  return min;
}
