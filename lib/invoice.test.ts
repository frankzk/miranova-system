import { test } from "node:test";
import assert from "node:assert/strict";
import { chargeAllocation, unitUsd, wholeQty, withMatches, type InvoiceExtract } from "./invoice.ts";

const inv: InvoiceExtract = {
  supplier: "Yiwu", invoice_number: "PI-1", invoice_date: "2026-09-17", currency: "CNY", total: null, notes: null,
  lines: [
    { description: "Set de pelador de verduras", sku: "00940184", quantity: 200, unit_price: 12.6, line_total: 2520 },
    { description: "Organizador de cocina", sku: null, quantity: 120, unit_price: null, line_total: 2520 },
    { description: "  ", sku: null, quantity: 5, unit_price: 1, line_total: 5 }, // sin nombre: fuera
    { description: "Muestra", sku: null, quantity: 0, unit_price: 0, line_total: 0 }, // cantidad 0: fuera
  ],
  charges: [{ label: "Flete", kind: "shipping", amount: 700 }],
};
const catalog = [
  { account_id: "hn", external_id: "p1", name: "Set de Pelador de Verduras Abridor", sku: "00940184", code: "ID-1" },
  { account_id: "hn", external_id: "p9", name: "Otro", sku: null, code: null },
];

test("factura → propuesta: productos sugeridos por SKU, sin líneas vacías", () => {
  const p = withMatches(inv, catalog);
  assert.equal(p.lines.length, 2);
  assert.deepEqual(p.lines[0].match, { account_id: "hn", external_id: "p1", name: "Set de Pelador de Verduras Abridor" });
  assert.equal(p.lines[1].match, null);
});

test("precio en USD con el tipo de cambio; si falta el unitario, total ÷ cantidad", () => {
  assert.equal(unitUsd(inv.lines[0], 7.1), 1.7746); // 12.6 / 7.1
  assert.equal(unitUsd(inv.lines[1], 7), 3); // 2520 / 120 / 7
  assert.equal(unitUsd({ unit_price: null, line_total: null, quantity: 3 }, 1), null);
  assert.equal(unitUsd(inv.lines[0], 0), null);
  assert.equal(chargeAllocation("shipping"), "units");
  assert.equal(chargeAllocation("import"), "value");
  assert.equal(wholeQty(120.0000001), 120);
});
