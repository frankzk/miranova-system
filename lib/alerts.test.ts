import assert from "node:assert/strict";
import { test } from "node:test";
import { describeAlert, type OwnerAlert } from "./alerts.ts";

const base = { account_id: "11111111-1111-4111-8111-111111111111", account: "Drop Honduras", country: "HN", currency: "HNL" };

test("cuenta frenada: rojo, con la semana anterior y enlace a sus órdenes", () => {
  const v = describeAlert({ ...base, kind: "account_stalled", severity: 1, data: { cur: 0, prev: 190, last_order: "2026-09-18T17:16:55Z" } }, "America/El_Salvador");
  assert.equal(v.tone, "danger");
  assert.equal(v.tag, "Hoy");
  assert.equal(v.title, "Drop Honduras: 0 pedidos en 7 días");
  assert.match(v.detail, /190/);
  assert.match(v.href, /^\/api\/scope\?account=11111111-/);
  assert.match(decodeURIComponent(v.href), /next=\/orders/);
});

test("tienda en caída: porcentaje con signo y filtro por tienda", () => {
  const v = describeAlert({ ...base, kind: "store_drop", severity: 1, data: { store: "Vital Market", cur: 34, prev: 119 } });
  assert.equal(v.title, "Vital Market: −71\u00a0% en 14 días");
  assert.equal(v.href, "/orders?dropshipper=Vital%20Market");
});

test("producto que crece desde cero: se describe como nuevo", () => {
  const v = describeAlert({ ...base, kind: "product_growth", severity: 3, data: { product: "Auto Wash Water Gun", cur: 60, prev: 0 } });
  assert.equal(v.tone, "info");
  assert.equal(v.tag, "Oportunidad");
  assert.match(v.title, /nuevo en alza/);
  assert.equal(v.href, "/products?q=Auto%20Wash%20Water%20Gun");
});

test("pedidos estancados: monto en la moneda de la cuenta y pestaña con más pedidos", () => {
  const a: OwnerAlert = { ...base, kind: "stuck_orders", severity: 1, data: { orders: 984, transit: 745, problem: 239, amount: 321821.5 } };
  const v = describeAlert(a);
  assert.equal(v.title, "Drop Honduras: 984 pedidos sin moverse hace más de 5 días");
  assert.match(v.detail, /L\u00a0321,821\.50/);
  assert.match(decodeURIComponent(v.href), /group=transit/);
});

test("entrega baja por paquetera: tasas en porcentaje", () => {
  const v = describeAlert({ ...base, account: "Drop Costa Rica", currency: "CRC", kind: "carrier_delivery", severity: 2, data: { carrier: "Wyn Plataforma Envio", rate: 0.521, avg: 0.569, failed: 45, closed: 94 } });
  assert.equal(v.title, "Wyn Plataforma Envio: 52\u00a0% de entrega en Drop Costa Rica");
  assert.match(v.detail, /57\u00a0%/);
  assert.equal(v.tone, "warning");
});
