import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyBoxfulProposal,
  boxfulProposal,
  type BoxfulAutofill,
  type BoxfulExtract,
  type PdfValue,
} from "./boxful-document.ts";
const clear = (value: string): PdfValue => ({
  value,
  evidence: "Dato del PDF: " + value,
  certainty: "clear",
});
const missing: PdfValue = { value: null, evidence: null, certainty: "missing" };
const read = (patch: Partial<BoxfulExtract> = {}): BoxfulExtract => ({
  kind: "single_transfer",
  date: clear("2026-10-28"),
  reference: clear("BX-104"),
  usd_amount: clear("6377.06"),
  original_currency: clear("USD"),
  original_amount: clear("6377.06"),
  warnings: [],
  ...patch,
});
const today = "2026-10-29";

test("Boxful PDF: propone fecha, referencia y monto exactos con evidencia", () => {
  const result = boxfulProposal(read(), today);
  assert.deepEqual(result.fields, {
    occurred_on: "2026-10-28",
    reference: "BX-104",
    amount: "6377.06",
    original_currency: "USD",
    original_amount: "6377.06",
  });
  assert.equal(result.warnings.length, 0);
  assert.ok(result.evidence.amount?.includes("6377.06"));
});
test("otra moneda: conserva el original sin inventar USD ni usar una cotización", () => {
  const result = boxfulProposal(
    read({
      usd_amount: missing,
      original_currency: clear("GTQ"),
      original_amount: clear("7750.00"),
    }),
    today,
  );
  assert.equal(result.fields.amount, "");
  assert.equal(result.fields.original_currency, "GTQ");
  assert.equal(result.fields.original_amount, "7750.00");
  assert.match(result.warnings.join(" "), /conversión/);
});
test("varias transferencias o documento ajeno: nunca elige ni suma importes", () => {
  for (const kind of [
    "multiple_transfers",
    "not_transfer",
    "unclear",
  ] as const) {
    const result = boxfulProposal(read({ kind }), today);
    assert.ok(Object.values(result.fields).every((value) => !value));
    assert.ok(result.warnings.length);
  }
});
test("fecha ambigua, futura, inexistente o referencia sin respaldo quedan vacías", () => {
  for (const date of [
    clear("2026-02-30"),
    clear("2026-10-30"),
    { ...clear("2026-10-10"), certainty: "uncertain" as const },
  ])
    assert.equal(boxfulProposal(read({ date }), today).fields.occurred_on, "");
  assert.equal(
    boxfulProposal(
      read({ reference: { ...clear("INVENTADA"), evidence: null } }),
      today,
    ).fields.reference,
    "",
  );
  assert.equal(
    boxfulProposal(read({ reference: clear("X".repeat(161)) }), today).fields
      .reference,
    "",
  );
});
test("importes: no redondea, no acepta separadores ambiguos y detecta contradicciones USD", () => {
  for (const amount of ["0", "-1", "1.001", "1,000.00", "1e3", "NaN"])
    assert.equal(
      boxfulProposal(read({ usd_amount: clear(amount) }), today).fields.amount,
      "",
    );
  assert.equal(
    boxfulProposal(read({ original_amount: clear("9999.00") }), today).fields
      .amount,
    "",
  );
});
test("una lectura tardía respeta ediciones y mantiene juntos moneda y monto originales", () => {
  const empty: BoxfulAutofill = {
    reference: "",
    occurred_on: "",
    amount: "",
    original_currency: "USD",
    original_amount: "",
  };
  const proposed = boxfulProposal(
    read({
      original_currency: clear("GTQ"),
      original_amount: clear("50000.00"),
    }),
    today,
  ).fields;
  const edited = {
    ...empty,
    reference: "MI-REFERENCIA",
    amount: "6400.00",
    original_currency: "HNL",
    original_amount: "160000.00",
  };
  const result = applyBoxfulProposal(edited, empty, proposed);
  assert.equal(result.reference, "MI-REFERENCIA");
  assert.equal(result.amount, "6400.00");
  assert.equal(result.original_currency, "HNL");
  assert.equal(result.original_amount, "160000.00");
  assert.equal(result.occurred_on, "2026-10-28");
});
