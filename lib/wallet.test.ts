import { test } from "node:test";
import assert from "node:assert/strict";
import { amountOf, toUsd, walletBalance } from "./wallet.ts";

test("lee el saldo en las formas más comunes", () => {
  assert.deepEqual(walletBalance({ data: { balance: 7424.94, updatedAt: "2026-10-09T10:00:00Z" } }), { balance: 7424.94, key: "data.balance", platformAt: "2026-10-09T10:00:00Z" });
  assert.equal(walletBalance({ currentBalance: "7424.94" })?.balance, 7424.94);
  assert.equal(walletBalance({ available_balance: 12 })?.balance, 12);
  assert.equal(walletBalance({ saldoActual: "1,250.50" })?.balance, 1250.5);
  assert.equal(walletBalance({ wallet: { amount: 100, currency: "USD" } })?.key, "wallet.amount");
  assert.equal(walletBalance({ balance: { available: 50, pending: 10 } })?.balance, 50);
  assert.equal(walletBalance({ success: true, result: { wallet: { id: "w1", balance: -3.5 } } })?.balance, -3.5);
  assert.equal(walletBalance([{ id: "w1", balance: 5, currency: "HNL" }])?.key, "[0].balance");
});

test("prefiere la clave del saldo a un monto suelto del mismo objeto", () => {
  assert.equal(walletBalance({ amount: 1, balance: 900 })?.balance, 900);
});

test("no confunde movimientos, conteos ni banderas con el saldo", () => {
  assert.equal(walletBalance({ data: [{ amount: -1.2, concept: "Descuento por envío" }, { amount: 30 }], total: 30, page: 1 }), null);
  assert.equal(walletBalance({ balance: { isBalanceDebit: null, isBalanceCredit: true } }), null);
  assert.equal(walletBalance({ message: "Not Found", statusCode: 404 }), null);
  assert.equal(walletBalance(null), null);
  assert.equal(walletBalance("7424.94"), null);
});

test("montos en texto", () => {
  assert.equal(amountOf("7,424.94"), 7424.94);
  assert.equal(amountOf("$ 120.50"), 120.5);
  assert.equal(amountOf("-15"), -15);
  assert.equal(amountOf("12,34"), null);
  assert.equal(amountOf("abc"), null);
  assert.equal(amountOf(Number.NaN), null);
  assert.equal(amountOf(true), null);
});

test("a dólares con el tipo de cambio de la cuenta", () => {
  assert.equal(toUsd(100, "USD", null), 100);
  assert.equal(toUsd(1000, "HNL", 0.0378), 37.8);
  assert.equal(toUsd(1000, "GTQ", null), null);
});
