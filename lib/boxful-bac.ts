import type { BoxfulExtract, PdfValue } from "./boxful-document.ts";
import { cents, decimal, validBankDay } from "./reconciliation.ts";
import { pdfMoney } from "./boxful-text.ts";

const missing = (): PdfValue => ({ value: null, evidence: null, certainty: "missing" });
const clear = (value: string, evidence: string): PdfValue => ({ value, evidence: evidence.trim().slice(0, 300), certainty: "clear" });

/** Formato BAC: importe enviado, comisión de origen y débito son conceptos distintos. */
export function parseBacTransfer(text: string): BoxfulExtract | null {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!/DETALLE DE CONSULTA DE TRANSACCIONES/i.test(normalized) || !/BOXFUL TECHNOLOGIES/i.test(normalized)) return null;
  const sections = normalized.split(/DATOS DE LA TRANSFERENCIA/i).slice(1);
  const empty: BoxfulExtract = { kind: "unclear", date: missing(), reference: missing(), usd_amount: missing(), original_currency: missing(), original_amount: missing(), warnings: [] };
  if (sections.length !== 1) return { ...empty, kind: sections.length > 1 ? "multiple_transfers" : "unclear" };
  const section = sections[0].split(/MANCOMUNACION ESTADO/i)[0];
  const refMatches = [...section.matchAll(/No\.\s*de referencia\s*:?\s*([A-Z0-9-]+)/gi)];
  if (new Set(refMatches.map(m => m[1])).size > 1) return { ...empty, kind: "multiple_transfers" };
  const ref = refMatches.length === 1 ? refMatches[0] : null;
  const dateMatch = section.match(/(?:^|\n)Fecha\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})\s+\d{2}:\d{2}:\d{2}/i);
  const date = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : "";
  const currency = section.match(/Cuenta de origen\s+[^\n]*?\b(USD|HNL|GTQ|EUR|MXN|CRC|NIO|COP)\b/i);
  const amounts = [...section.matchAll(/Monto a Transferir\s*:\s*([\d][\d.,]*)/gi)];
  const amount = amounts.length === 1 ? pdfMoney(amounts[0][1]) : null;
  const fee = section.match(/Comision\s*:\s*([\d][\d.,]*)/i);
  const tax = section.match(/I\.?\s*V\.?\s*A\.?\s*:\s*([\d][\d.,]*)/i);
  const debit = section.match(/Total a debitar\s*:\s*([\d][\d.,]*)/i);
  const feeCents = fee ? cents(pdfMoney(fee[1]) ?? "") : null;
  const taxCents = tax ? cents(pdfMoney(tax[1]) ?? "") : null;
  const debitCents = debit ? cents(pdfMoney(debit[1]) ?? "") : null;
  const sentCents = cents(amount ?? "");
  const contradiction = sentCents !== null && feeCents !== null && taxCents !== null && debitCents !== null && sentCents + feeCents + taxCents !== debitCents;
  const original = amount && !contradiction ? clear(amount, amounts[0][0]) : missing();
  const warnings: string[] = [];
  if (contradiction) warnings.push("El importe, comisión e IVA no coinciden con el total debitado. Revisa los montos del PDF; no se calculó un importe sustituto.");
  if (feeCents !== null && feeCents > 0) warnings.push(`Comisión del banco de origen: ${decimal(feeCents)} ${currency?.[1]?.toUpperCase() ?? "(confirma moneda)"}. No se descontó del monto enviado ni se usó como comisión de conciliación.`);
  if (/Descripcion\s+[^\n]*\bMIREVA\b/i.test(section)) warnings.push("El concepto del comprobante indica MIREVA. Verifica la empresa seleccionada antes de guardar.");
  return {
    kind: "single_transfer",
    date: dateMatch && validBankDay(date) ? clear(date, dateMatch[0]) : missing(),
    reference: ref ? clear(ref[1], ref[0]) : missing(),
    usd_amount: currency?.[1].toUpperCase() === "USD" ? original : missing(),
    original_currency: currency ? clear(currency[1].toUpperCase(), currency[0]) : missing(),
    original_amount: original,
    warnings,
  };
}
