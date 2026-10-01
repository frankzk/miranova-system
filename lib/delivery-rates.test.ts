import assert from "node:assert/strict";
import { test } from "node:test";
import { completedOrders, deliveryRate, openOrders, readDeliveryPages, summarizeDeliveries, type DeliveryOrder } from "./delivery-rates.ts";

const accounts = [{ id: "sv", country: "SV" }, { id: "hn", country: "HN" }];
const order = (status_code: string | null, account_id = "sv", carrier: string | null = "Xpress"): DeliveryOrder => ({ id: "1", status_code, account_id, carrier });

test("terminal outcomes: all pending, transit, problems and unknown codes stay outside the denominator", () => {
  const codes = ["4", "4", "7", "8", "5", "cancelled", "rejected", "registered", "pending", "fulfilled", "-1", "1", "2", "3", "12", "pending_correction", "6", "future", null];
  const { total } = summarizeDeliveries(codes.map((c) => order(c)), accounts);
  assert.equal(total.total, 19);
  assert.equal(completedOrders(total), 4);
  assert.equal(deliveryRate(total), 0.5);
  assert.equal(completedOrders(total, true), 7);
  assert.equal(deliveryRate(total, true), 2 / 7);
  assert.equal(openOrders(total), 10);
  assert.equal(total.unknown, 2);
});

test("empty denominator is unavailable, not a misleading zero; actual failed deliveries are zero", () => {
  assert.equal(deliveryRate(summarizeDeliveries([order("2")], accounts).total), null);
  assert.equal(deliveryRate(summarizeDeliveries([], accounts).total), null);
  assert.equal(deliveryRate(summarizeDeliveries([order("8")], accounts).total), 0);
});

test("country and carrier identity stay separate; summary is weighted by operations", () => {
  const orders = [order("4"), order("4", "hn"), order("8", "hn"), order("8", "hn"), order("8", "hn")];
  const result = summarizeDeliveries(orders, accounts);
  assert.equal(result.rows.length, 2);
  assert.equal(deliveryRate(result.total), 2 / 5);
  assert.equal(summarizeDeliveries([order("4", "outside")], accounts).total.total, 0);
  assert.equal(summarizeDeliveries([order("4", "sv", null)], accounts).rows[0].carrier, "Sin transportadora");
  assert.equal(summarizeDeliveries([order("4"), order("4", "sv", "c807 Xpress")], accounts).rows.length, 2);
});

test("reproduces the reviewed El Salvador rates, including the optional cancelled denominator", () => {
  const orders = [
    ...Array.from({ length: 350 }, () => order("4")),
    ...Array.from({ length: 108 }, () => order("8")),
    ...Array.from({ length: 12 }, () => order("cancelled")),
    ...Array.from({ length: 73 }, () => order("3")),
  ];
  const { total } = summarizeDeliveries(orders, accounts);
  assert.equal(total.total, 543);
  assert.equal((deliveryRate(total)! * 100).toFixed(1), "76.4");
  assert.equal((deliveryRate(total, true)! * 100).toFixed(1), "74.5");
});

test("reads beyond 1000 orders even when the provider returns smaller pages", async () => {
  const data = Array.from({ length: 1205 }, (_, i) => ({ ...order("4"), id: String(i).padStart(5, "0") }));
  const rows = await readDeliveryPages(async (after) => data.filter((o) => !after || o.id > after).slice(0, 300));
  assert.equal(rows.length, 1205);
  assert.equal(new Set(rows.map((r) => r.id)).size, 1205);
});

test("query failures do not produce partial or zero statistics", async () => {
  await assert.rejects(readDeliveryPages(async (after) => { if (after) throw new Error("offline"); return [order("4")]; }), /offline/);
  await assert.rejects(readDeliveryPages(async () => [order("4")]), /no avanzó/);
});
