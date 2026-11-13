import assert from "node:assert/strict";
import { test } from "node:test";
import { boxfulList, boxfulRaw, boxfulSettlement, boxfulSettlements } from "./boxful-settlements.ts";

// forma real de /settlement/client (datos cambiados; los envíos traen datos de clientes)
const settlement = (o: Record<string, unknown> = {}) => ({
  credits: [],
  id: "s1",
  confirmationNumber: "2357651-2357652-2357653-2357949-42402235",
  clientId: "c1",
  createdAt: "2026-11-11T11:22:15.317Z",
  codAmount: 169352.95,
  comissionAmount: 7620.88,
  shipmentAmount: 24836,
  total: 129562.55,
  bankId: "b1",
  bankAccount: "202400001234",
  exchangeRateToUsd: null,
  cryptoNetAmountUsd: null,
  shipments: [
    { id: "e1", customerName: "Ana", customerLastname: "Pérez", customerPhone: "99999999", customerAddress: "Calle 1", customerEmail: "x@y.z", codAmount: 890 },
    { id: "e2", customerName: "Luis", customerPhone: "88888888", codAmount: 500 },
  ],
  ...o,
});

test("lista de la respuesta", () => {
  assert.equal(boxfulList({ status: "success", settlements: [settlement(), settlement({ id: "s2" })] }).length, 2);
  assert.equal(boxfulList({ data: { settlements: [settlement()] } }).length, 1);
  assert.deepEqual(boxfulList({ status: "success", settlement: null }), []);
});

test("liquidación: referencia con los números de confirmación, monto, cuenta enmascarada y sin datos de clientes", () => {
  const s = boxfulSettlement(settlement())!;
  assert.equal(s.external_id, "s1");
  assert.equal(s.reference, "2357651-2357652-2357653-2357949-42402235");
  assert.equal(s.requested_at, "2026-11-11T11:22:15.317Z");
  assert.equal(s.status, "paid");
  assert.equal(s.status_label, "Liquidada");
  assert.equal(s.amount_cents, 12_956_255);
  assert.equal(s.usd_rate, null);
  assert.equal(s.bank_account, "••1234");
  assert.equal(s.raw.shipments_count, 2);
  assert.equal(s.raw.codAmount, 169352.95);
  const raw = JSON.stringify(s.raw);
  assert.doesNotMatch(raw, /Ana|Pérez|99999999|Calle|x@y\.z|Luis|202400001234/);
  // si Boxful informa lo liquidado aparte, manda eso sobre el total
  assert.equal(boxfulSettlement(settlement({ liquidatedAmount: 128502.55 }))!.amount_cents, 12_850_255);
  // con estado
  assert.equal(boxfulSettlement(settlement({ status: "rejected" }))!.status, "rejected");
  // sin datos suficientes
  assert.equal(boxfulSettlement(settlement({ id: "" })), null);
  assert.equal(boxfulSettlement(settlement({ total: 0 })), null);
  assert.equal(boxfulSettlement(settlement({ createdAt: "no" })), null);
});

test("raw: fuera los datos personales aunque vengan arriba", () => {
  const raw = boxfulRaw({ id: "x", customerName: "Ana", recolectionPhone: "1", total: 5, nested: { a: 1 }, shipments: [1, 2, 3] });
  assert.deepEqual(raw, { id: "x", total: 5, shipments_count: 3 });
});

test("varias ventanas de fechas: sin repetir", () => {
  const a = { settlements: [settlement(), settlement({ id: "s2" })] };
  const b = { settlements: [settlement({ id: "s2" }), settlement({ id: "s3" })] };
  assert.deepEqual(boxfulSettlements([a, b]).map((s) => s.external_id).sort(), ["s1", "s2", "s3"]);
});
