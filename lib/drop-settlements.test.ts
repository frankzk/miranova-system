import assert from "node:assert/strict";
import { test } from "node:test";
import { movementList, movementType, summarizeMovements } from "./drop-settlements.ts";

const credit = (id: string) => ({ id, requestType: { name: "settlement_credit", label: "Abono por liquidación de envío", category: null }, amount: 570, evidence: [], transfer: null });
const payout = { id: "p1", requestType: { name: "settlement_request", label: "Liquidación" }, amount: -363000, transfer: { reference: "ILGA5JTC" } };

test("lista de movimientos y tipo", () => {
  const page = { status: "success", data: { movements: [credit("a"), payout], balance: 170578.67, pagination: { page: 1, total: 2 } } };
  assert.equal(movementList(page).length, 2);
  assert.equal(movementList([credit("x")]).length, 1);
  assert.deepEqual(movementList({ data: null }), []);
  assert.equal(movementType(credit("a")), "settlement_credit");
  assert.equal(movementType({ type: "withdrawal" }), "withdrawal");
  assert.equal(movementType({}), "sin_tipo");
});

test("resumen: cuántos de cada tipo, un ejemplo y lo que acompaña a la lista", () => {
  const p1 = { data: { movements: [credit("a"), credit("b"), payout], balance: 1, pagination: { page: 1 } } };
  const p2 = { data: { movements: [credit("c")], pagination: { page: 2 } } };
  const s = summarizeMovements([p1, p2]);
  assert.equal(s.pages, 2);
  assert.equal(s.total, 4);
  assert.equal(s.types.settlement_credit.count, 3);
  assert.equal(s.types.settlement_request.label, "Liquidación");
  assert.match(s.types.settlement_request.sample, /ILGA5JTC/);
  assert.equal(s.meta, JSON.stringify({ data: { movements: "[3]", balance: 1, pagination: { page: 1 } } }));
  assert.deepEqual(summarizeMovements([]).types, {});
});
