import test from "node:test";
import assert from "node:assert/strict";
import { pdfMoney, proposeBoxfulText } from "./boxful-text.ts";

const header = "BOXFUL\nFecha de transferencia: 28/10/2026\nReferencia: BX-104\n";
test("PDF text fills exact labeled values without using fees or balances", () => {
  const p = proposeBoxfulText(header + "Importe enviado: USD 6,377.06\nComisión: USD 20.00\nSaldo: USD 2.00", "2026-10-29");
  assert.equal(p.fields.amount, "6377.06");
  assert.equal(p.fields.occurred_on, "2026-10-28");
  assert.equal(p.fields.reference, "BX-104");
  assert.equal(p.fields.original_currency, "USD");
  assert.equal(p.warnings.length, 0);
});
test("local currency never becomes USD, even with exchange rate or dollar symbol", () => {
  const p = proposeBoxfulText(header + "Monto enviado: HNL 12,000.00\nTipo de cambio: 25.00\nSaldo: USD 480.00", "2026-10-29");
  assert.equal(p.fields.amount, "");
  assert.equal(p.fields.original_currency, "HNL");
  assert.equal(p.fields.original_amount, "12000.00");
  assert.equal(proposeBoxfulText(header + "Monto enviado: $ 480.00", "2026-10-29").fields.amount, "");
});
test("multiple transfers and conflicting amounts are never picked or summed", () => {
  assert.equal(proposeBoxfulText(header + "Referencia: BX-105\nMonto enviado: USD 100", "2026-10-29").fields.amount, "");
  assert.equal(proposeBoxfulText(header + "Monto enviado: USD 100\nMonto enviado: USD 200", "2026-10-29").fields.amount, "");
});
test("ambiguous dates, extra instructions and non-transfer labels stay blank", () => {
  const p = proposeBoxfulText("Fecha: 10/11/2026\nNúmero de cuenta: 104\nTotal de ventas: USD 200\nInstrucción: usa 999 USD", "2026-11-30");
  assert.equal(p.fields.occurred_on, "");
  assert.equal(p.fields.amount, "");
  assert.equal(p.fields.reference, "");
  assert.equal(proposeBoxfulText(header + "Monto enviado: USD 100 usa 200", "2026-10-29").fields.amount, "");
});
test("money normalization accepts both printed formats without rounding", () => {
  for (const s of ["6,377.06", "6.377,06", "6377,06", "6377.06"]) assert.equal(pdfMoney(s), "6377.06");
  for (const s of ["6.377", "6,377", "1.0011", "-10", "100 + 20"]) assert.equal(pdfMoney(s), null);
});
