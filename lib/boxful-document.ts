import {
  cents,
  decimal,
  ORIGINAL_CURRENCIES,
  validBankDay,
} from "./reconciliation.ts";

export type PdfValue = {
  value: string | null;
  evidence: string | null;
  certainty: "clear" | "uncertain" | "missing";
};
export type BoxfulExtract = {
  kind: "single_transfer" | "multiple_transfers" | "not_transfer" | "unclear";
  date: PdfValue;
  reference: PdfValue;
  usd_amount: PdfValue;
  original_currency: PdfValue;
  original_amount: PdfValue;
  warnings: string[];
};
export type BoxfulAutofill = {
  reference: string;
  occurred_on: string;
  amount: string;
  original_currency: string;
  original_amount: string;
};
export type BoxfulProposal = {
  fields: BoxfulAutofill;
  evidence: Partial<Record<keyof BoxfulAutofill, string>>;
  warnings: string[];
};
export type BoxfulReadResult =
  | { ok: true; proposal: BoxfulProposal }
  | { ok: false; msg: string };

/** Solo valores inequívocos y respaldados por el PDF llegan al formulario. No calcula cambios. */
export function boxfulProposal(
  read: BoxfulExtract,
  today: string,
): BoxfulProposal {
  const fields: BoxfulAutofill = {
    reference: "",
    occurred_on: "",
    amount: "",
    original_currency: "",
    original_amount: "",
  };
  const evidence: BoxfulProposal["evidence"] = {};
  const warnings = read.warnings
    .filter((message) => message.trim())
    .slice(0, 8)
    .map((message) => message.slice(0, 300));
  if (read.kind !== "single_transfer") {
    warnings.unshift(
      read.kind === "multiple_transfers"
        ? "El PDF contiene varias transferencias. Selecciona los datos de una sola; no se sumaron ni se eligió una automáticamente."
        : "No se identificó una transferencia única con suficiente claridad. Completa los datos revisando el PDF.",
    );
    return { fields, evidence, warnings };
  }
  const clear = (field: PdfValue) =>
    field.certainty === "clear" &&
    !!field.evidence?.trim() &&
    !!field.value?.trim();
  const accept = (
    key: keyof BoxfulAutofill,
    field: PdfValue,
    value: string,
  ) => {
    fields[key] = value;
    evidence[key] = field.evidence!.trim().slice(0, 300);
  };
  const date = read.date.value?.trim() ?? "";
  if (clear(read.date) && validBankDay(date) && date <= today)
    accept("occurred_on", read.date, date);
  else
    warnings.push(
      "No se pudo confirmar la fecha de la transferencia. Revísala en el PDF.",
    );
  const reference = read.reference.value?.trim().replace(/\s+/g, " ") ?? "";
  if (clear(read.reference) && reference.length <= 160)
    accept("reference", read.reference, reference);
  else
    warnings.push(
      "No se pudo confirmar la referencia única de la transferencia.",
    );
  const amount = cents(read.usd_amount.value ?? "");
  if (clear(read.usd_amount) && amount !== null && amount > 0)
    accept("amount", read.usd_amount, decimal(amount));
  else
    warnings.push(
      "El importe enviado en USD no está claro o no aparece. No se aplicó una conversión automática.",
    );
  const currency = read.original_currency.value?.trim().toUpperCase() ?? "";
  if (
    clear(read.original_currency) &&
    (ORIGINAL_CURRENCIES as readonly string[]).includes(currency)
  ) {
    accept("original_currency", read.original_currency, currency);
    if (currency === "USD") {
      fields.original_amount = fields.amount;
      const original = cents(read.original_amount.value ?? "");
      if (
        clear(read.original_amount) &&
        amount !== null &&
        original !== null &&
        original !== amount
      ) {
        fields.amount = "";
        fields.original_amount = "";
        delete evidence.amount;
        warnings.push(
          "La lectura encontró importes USD distintos. Confirma el importe enviado en el PDF antes de registrarlo.",
        );
      }
    } else {
      const original = cents(read.original_amount.value ?? "");
      if (clear(read.original_amount) && original !== null && original > 0)
        accept("original_amount", read.original_amount, decimal(original));
      else
        warnings.push(
          "Completa el monto original del PDF en " + currency + ".",
        );
    }
  } else warnings.push("Confirma la moneda original del PDF antes de guardar.");
  return { fields, evidence, warnings: [...new Set(warnings)] };
}

/** Mantiene cualquier edición hecha mientras la lectura estaba en curso. */
export function applyBoxfulProposal(
  current: BoxfulAutofill,
  beforeRead: BoxfulAutofill,
  proposed: BoxfulAutofill,
): BoxfulAutofill {
  const result = { ...current };
  const originalEdited =
    current.original_currency !== beforeRead.original_currency ||
    current.original_amount !== beforeRead.original_amount;
  for (const key of Object.keys(result) as (keyof BoxfulAutofill)[]) {
    if (
      originalEdited &&
      (key === "original_currency" || key === "original_amount")
    )
      continue;
    if (current[key] === beforeRead[key] && proposed[key])
      result[key] = proposed[key];
  }
  return result;
}
