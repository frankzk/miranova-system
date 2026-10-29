import { boxfulProposal, type BoxfulExtract, type PdfValue } from "./boxful-document.ts";

const missing = (): PdfValue => ({ value: null, evidence: null, certainty: "missing" });
const plain = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

// Conserva centavos exactos; un separador con tres cifras es ambiguo.
export function pdfMoney(input: string): string | null {
  let s = input.trim().replace(/\s/g, "");
  if (/^\d{1,3}(,\d{3})+\.\d{1,2}$/.test(s)) s = s.replace(/,/g, "");
  else if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null;
  return s;
}

function pdfDate(input: string): string | null {
  const s = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  if (a <= 12 && b <= 12 && a !== b) return null;
  const day = a > 12 || a === b ? a : b;
  const month = a > 12 || a === b ? b : a;
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

type Labeled = { label: string; value: string; evidence: string };
export function parseBoxfulText(text: string): BoxfulExtract {
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const rows: Labeled[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(.{2,55}?)\s*[:：]\s*(.*)$/);
    if (m) rows.push({ label: plain(m[1]), value: m[2] || lines[i + 1] || "", evidence: (lines[i] + (m[2] ? "" : " " + (lines[i + 1] || ""))).slice(0, 300) });
  }
  const dates = rows.filter(r => /^(fecha(?: de (?:la )?(?:transferencia|transaccion|ejecucion|envio))?|transfer date|transaction date|execution date)$/.test(r.label));
  const refs = rows.filter(r => /^(referencia(?: bancaria| de (?:la )?transferencia)?|(?:numero|n[°ºo.]*) de (?:referencia|comprobante|transferencia)|id de (?:transferencia|transaccion)|transaction id|transfer id|reference)$/.test(r.label));
  const amounts = rows.filter(r => /^(?:(?:importe|monto)(?: enviado| transferido| de (?:la )?transferencia| en (?:usd|dolares))|total (?:a transferir|transferido)|amount sent|transfer amount)$/.test(r.label));
  const currencies = rows.filter(r => /^(moneda(?: original)?|currency)$/.test(r.label));
  const choose = (rs: Labeled[], map: (s: string) => string | null): PdfValue => {
    if (!rs.length) return missing();
    const values = rs.map(r => map(r.value));
    const unique = new Set(values);
    if (unique.size !== 1 || !values[0]) return { value: null, evidence: rs[0].evidence, certainty: "uncertain" };
    return { value: values[0], evidence: rs[0].evidence, certainty: "clear" };
  };
  const currency = (s: string) => {
    const matches = [...s.toUpperCase().matchAll(/\b(USD|HNL|GTQ|EUR|MXN|COP|PEN|CRC|NIO)\b|US\$|D[ÓO]LARES ESTADOUNIDENSES/g)].map(m => m[1] || "USD");
    return new Set(matches).size === 1 ? matches[0] : null;
  };
  const originalCurrency = choose(currencies, currency);
  const moneyRows = amounts.map(r => ({ ...r, currency: currency(r.value + " " + r.label) || (originalCurrency.certainty === "clear" ? originalCurrency.value : null) }));
  const money = (s: string) => {
    const value = s.toUpperCase().replace(/\b(?:USD|HNL|GTQ|EUR|MXN|COP|PEN|CRC|NIO)\b|US\$|D[ÓO]LARES ESTADOUNIDENSES|\$/g, "").trim();
    return pdfMoney(value);
  };
  const distinctRefs = new Set(refs.map(r => r.value.trim()).filter(Boolean));
  const kind = distinctRefs.size > 1 ? "multiple_transfers" : refs.length || dates.length || amounts.length ? "single_transfer" : "unclear";
  const local = moneyRows.filter(r => r.currency && r.currency !== "USD");
  const usd = moneyRows.filter(r => r.currency === "USD");
  const original = local.length ? local : usd;
  const inferredCurrency = original.length ? { value: original[0].currency, evidence: original[0].evidence, certainty: new Set(original.map(r => r.currency)).size === 1 ? "clear" as const : "uncertain" as const } : originalCurrency;
  return {
    kind,
    date: choose(dates, pdfDate),
    reference: choose(refs, s => /^[\p{L}\p{N}][\p{L}\p{N} ./_#-]{1,159}$/u.test(s.trim()) ? s.trim() : null),
    usd_amount: choose(usd, money),
    original_currency: inferredCurrency,
    original_amount: choose(original, money),
    warnings: [],
  };
}

export const proposeBoxfulText = (text: string, today: string) => boxfulProposal(parseBoxfulText(text), today);
