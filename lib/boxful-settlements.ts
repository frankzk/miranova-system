// Liquidaciones de Boxful (Mireva): GET /settlement/client?begin&end devuelve { settlements: [...] } con
//   { id, confirmationNumber: "2357651-2357652-…", createdAt, codAmount, comissionAmount, shipmentAmount,
//     total, bankAccount, exchangeRateToUsd, credits: [...], shipments: [ envíos con datos de clientes ] }
// Los números de confirmación son las referencias de los PDF de Boxful/BAC. De cada liquidación se guarda solo
// lo de la liquidación: nunca los envíos (traen nombre, teléfono y dirección de clientes). Sin base de datos.

import { maskAccount, settlementStatus, type DropSettlement } from "./drop-settlements.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const text = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");

/** La lista de liquidaciones de la respuesta. */
export function boxfulList(json: unknown): Obj[] {
  if (isObj(json) && Array.isArray(json.settlements)) return json.settlements.filter(isObj);
  if (isObj(json) && isObj(json.data) && Array.isArray(json.data.settlements)) return json.data.settlements.filter(isObj);
  return Array.isArray(json) ? json.filter(isObj) : [];
}

/** El monto liquidado: el que informe Boxful como transferido/liquidado; si no, el total. */
const AMOUNT_KEYS = ["liquidatedAmount", "settledAmount", "transferredAmount", "transferAmount", "amountToTransfer", "netAmount", "total"];
/** Datos personales: nunca se guardan (por si Boxful agrega alguno arriba). */
const PERSONAL = /customer|phone|address|email|lastname|recolection|^name$/i;

/** Lo de la liquidación que sirve para revisar: sin envíos ni datos personales (de los envíos, solo cuántos). */
export function boxfulRaw(s: Obj): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "shipments") out.shipments_count = Array.isArray(v) ? v.length : null;
    else if (k === "credits") out.credits_count = Array.isArray(v) ? v.length : null;
    else if (PERSONAL.test(k)) continue;
    else if (/account/i.test(k) && (typeof v === "string" || typeof v === "number")) out[k] = maskAccount(v); // la cuenta, enmascarada
    else if (v === null || typeof v !== "object") out[k] = v;
  }
  return out;
}

/** Enlaces de comprobantes que adjunte Boxful arriba en la liquidación. */
function evidenceUrls(s: Obj): string[] {
  return Object.entries(s)
    .filter(([k, v]) => /url|voucher|receipt|proof|file|evidence/i.test(k) && typeof v === "string" && /^https:\/\//i.test(v))
    .map(([, v]) => (v as string).slice(0, 1000))
    .slice(0, 10);
}

/** La liquidación en la forma de la tabla settlements (lo mismo que trae Drop), o null si le faltan datos. */
export function boxfulSettlement(s: Obj): DropSettlement | null {
  const id = text(s.id ?? s._id);
  const createdAt = text(s.createdAt ?? s.date);
  if (!id || !createdAt || !Number.isFinite(Date.parse(createdAt))) return null;
  let amount: number | null = null;
  for (const k of AMOUNT_KEYS) {
    const n = num(s[k]);
    if (n !== null && n > 0) {
      amount = n;
      break;
    }
  }
  if (amount === null) return null;
  const rate = num(s.exchangeRateToUsd);
  const usd = num(s.cryptoNetAmountUsd);
  // sin estado en la lista: las que aparecen ya están liquidadas
  const st = s.status === undefined || s.status === null ? { status: "paid" as const, label: "Liquidada" } : settlementStatus(s.status);
  const bank = isObj(s.bank) ? text(s.bank.name) : text(s.bankName);
  return {
    external_id: id,
    reference: text(s.confirmationNumber, 400) || id,
    confirmation: "",
    requested_at: new Date(createdAt).toISOString(),
    status: st.status,
    status_label: st.label,
    failure_reason: text(s.failureReason ?? s.rejectionReason, 300),
    amount_cents: Math.round(amount * 100),
    usd_rate: rate && rate > 0 ? rate : null,
    usd_amount_cents: usd && usd > 0 ? Math.round(usd * 100) : null,
    bank,
    bank_account: maskAccount(s.bankAccount),
    evidence: evidenceUrls(s),
    raw: boxfulRaw(s),
  };
}

/** Todas las de una o varias respuestas, sin repetir (las ventanas de fechas se pueden pisar). */
export function boxfulSettlements(payloads: unknown[]): DropSettlement[] {
  const out = new Map<string, DropSettlement>();
  for (const p of payloads) for (const s of boxfulList(p)) {
    const row = boxfulSettlement(s);
    if (row) out.set(row.external_id, row);
  }
  return [...out.values()];
}
