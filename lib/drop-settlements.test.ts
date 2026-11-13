import assert from "node:assert/strict";
import { test } from "node:test";
import {
  maskAccount, movementList, movementTotal, movementType, oldestMovementAt, settlementFromMovement, settlementStatus,
  settlementsFromPage,
} from "./drop-settlements.ts";

// forma real de un "Descuento por liquidación" de Drop (datos cambiados)
const debit = (o: Record<string, unknown> = {}, s: Record<string, unknown> = {}) => ({
  requestType: { name: "settlement_debit", label: "Descuento por liquidación", category: null },
  exchangeRate: { rate: 0.0388581101, at: "2026-11-05T02:14:19.673Z", backfilled: false },
  evidence: [],
  transfer: null,
  id: "mov1",
  settlementId: "set1",
  type: "debit",
  amount: 363000,
  createdAt: "2026-11-05T02:14:19.675Z",
  settlement: {
    id: "set1", requestCode: "ILGA5JTC", createdAt: "2026-11-05T02:14:19.248Z", updatedAt: "2026-11-07T16:06:50.110Z",
    type: "international", amount: 363000, transferredAmount: null, status: "settled", bankAccountNumber: "202400001234",
    bankName: "Choice Financial Group", beneficiaryName: "EMPRESA LLC", beneficiaryAddress: "Calle 1", notificationEmail: "a@b.c",
    confirmationNumber: "2355766", usdAmount: null, settlementFailureReason: null, settlementFailedAt: null, ...s,
  },
  ...o,
});
const credit = (id: string, at: string) => ({ requestType: { name: "settlement_credit", label: "Abono por liquidación de envío" }, id, amount: 570, createdAt: at, settlement: null, orderId: "o1" });

test("página de la billetera: lista, total, tipo y el movimiento más viejo", () => {
  const page = { status: "success", data: { movements: [credit("a", "2026-11-12T10:00:00Z"), debit(), credit("b", "2026-11-01T10:00:00Z")], total: 1055, balance: 1 } };
  assert.equal(movementList(page).length, 3);
  assert.equal(movementTotal(page), 1055);
  assert.equal(movementTotal({ data: {} }), null);
  assert.equal(movementType(debit()), "settlement_debit");
  assert.equal(movementType({}), "sin_tipo");
  assert.equal(oldestMovementAt(page), Date.parse("2026-11-01T10:00:00Z"));
  assert.equal(oldestMovementAt({ data: { movements: [] } }), null);
});

test("liquidación desde el movimiento: referencia, confirmación, monto, tasa, cuenta enmascarada, sin datos personales", () => {
  const s = settlementFromMovement(debit())!;
  assert.equal(s.external_id, "set1");
  assert.equal(s.reference, "ILGA5JTC");
  assert.equal(s.confirmation, "2355766");
  assert.equal(s.requested_at, "2026-11-05T02:14:19.248Z");
  assert.equal(s.status, "paid");
  assert.equal(s.status_label, "Liquidada");
  assert.equal(s.amount_cents, 36_300_000);
  assert.equal(s.usd_rate, 0.0388581101);
  assert.equal(s.usd_amount_cents, null);
  assert.equal(s.bank, "Choice Financial Group");
  assert.equal(s.bank_account, "••1234");
  assert.deepEqual(s.evidence, []);
  const raw = JSON.stringify(s.raw);
  assert.doesNotMatch(raw, /EMPRESA|Calle|a@b\.c|202400001234/);
  assert.match(raw, /settlement_debit/);
  // monto en USD y comprobante si Drop los trae; rechazada con motivo
  const r = settlementFromMovement(debit({ evidence: [{ url: "https://x.y/c.pdf" }, "http://inseguro"] }, { usdAmount: 14085.49, status: "rejected", settlementFailureReason: "Cuenta inválida" }))!;
  assert.equal(r.usd_amount_cents, 1_408_549);
  assert.deepEqual(r.evidence, ["https://x.y/c.pdf"]);
  assert.equal(r.status, "rejected");
  assert.equal(r.failure_reason, "Cuenta inválida");
  // no es liquidación, o le faltan datos
  assert.equal(settlementFromMovement(credit("a", "2026-11-01T00:00:00Z")), null);
  assert.equal(settlementFromMovement(debit({}, { amount: 0 })), null);
  assert.equal(settlementFromMovement(debit({ createdAt: null }, { createdAt: "no" })), null);
});

test("estados de Drop", () => {
  assert.deepEqual(settlementStatus("settled"), { status: "paid", label: "Liquidada" });
  assert.deepEqual(settlementStatus("REJECTED"), { status: "rejected", label: "Rechazada" });
  assert.deepEqual(settlementStatus("failed"), { status: "rejected", label: "Fallida" });
  assert.deepEqual(settlementStatus("pending"), { status: "pending", label: "Pendiente" });
  assert.deepEqual(settlementStatus("processing"), { status: "pending", label: "En proceso" });
  // así lo manda Drop mientras procesa una solicitud
  assert.deepEqual(settlementStatus("in_process"), { status: "pending", label: "En proceso" });
  assert.deepEqual(settlementStatus(null), { status: "pending", label: "Pendiente" });
  assert.deepEqual(settlementStatus("raro"), { status: "pending", label: "raro" });
});

test("sin repetir: la misma solicitud en el descuento y en su devolución", () => {
  const refund = debit({ requestType: { name: "settlement_refund_credit" }, id: "mov2", exchangeRate: null }, { status: "rejected" });
  const list = settlementsFromPage({ data: { movements: [refund, debit({}, { status: "rejected" }), debit({ id: "m3", settlementId: "set2" }, { id: "set2", requestCode: "QB65AIKE" })] } });
  assert.deepEqual(list.map((s) => s.reference).sort(), ["ILGA5JTC", "QB65AIKE"]);
  assert.equal(list.find((s) => s.reference === "ILGA5JTC")!.usd_rate, 0.0388581101);
  assert.equal(maskAccount("12"), "12");
});
