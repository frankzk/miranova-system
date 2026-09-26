import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ageDays, lowMovementCauses, perStoreDay, productInsights, productOpportunity, sortProducts, trend, type ProductPerf,
} from "./product-insights.ts";

const NOW = Date.parse("2026-09-26T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const row = (p: Partial<ProductPerf>): ProductPerf => ({
  account_id: "a", account_name: "Drop Honduras", currency: "HNL", product_key: "p1", product_id: "u1", name: "Shilajit",
  image_url: null, status: "Activo", stock: 100, created_at: daysAgo(60), first_order_at: null,
  orders7: 0, prev7: 0, orders30: 0, units30: 0, stores30: 0, stores7: 0, ticket: null,
  active_stores30: 30, active_stores7: 25, daily: [], ...p,
});

test("tendencia como el semáforo de tiendas", () => {
  assert.equal(trend({ orders7: 140, prev7: 100 }), "strong"); // +40%
  assert.equal(trend({ orders7: 120, prev7: 100 }), "growing"); // +20%
  assert.equal(trend({ orders7: 105, prev7: 100 }), "stable");
  assert.equal(trend({ orders7: 80, prev7: 100 }), "declining");
  assert.equal(trend({ orders7: 60, prev7: 100 }), "falling");
  assert.equal(trend({ orders7: 5, prev7: 0 }), "new");
  assert.equal(trend({ orders7: 0, prev7: 0 }), "none");
  // poco volumen: 3 → 1 no es −67%
  assert.equal(trend({ orders7: 1, prev7: 3 }), "low");
});

test("días disponible: alta en el catálogo, si no el primer pedido", () => {
  assert.equal(ageDays(row({ created_at: daysAgo(20) }), NOW), 20);
  assert.equal(ageDays(row({ created_at: null, first_order_at: daysAgo(9) }), NOW), 9);
  assert.equal(ageDays(row({ created_at: null, first_order_at: null }), NOW), null);
});

test("pedidos por tienda por día: si es nuevo, sobre los días que lleva", () => {
  assert.equal(perStoreDay(row({ orders30: 60, stores30: 2 }), NOW), 1); // 30 por tienda en 30 días
  assert.equal(perStoreDay(row({ orders30: 60, stores30: 2, created_at: daysAgo(10) }), NOW), 3);
});

test("potencial de expansión: mucho por tienda y pocas tiendas lo venden", () => {
  const p = row({ orders7: 150, prev7: 140, orders30: 600, units30: 700, stores30: 6, active_stores30: 56 });
  const o = productOpportunity(p, NOW)!;
  assert.equal(o.kind, "expansion");
  assert.match(o.detail, /Solo 6 tiendas lo venden · 3\.3 pedidos\/día por tienda · 50 tiendas todavía no lo venden/);
  assert.match(o.action, /comunidad/);
  // ya lo vende la mitad de la cuenta: no es expansión
  assert.equal(productOpportunity(row({ ...p, stores30: 28 }), NOW)?.kind ?? null, null);
  // sin inventario no se empuja
  assert.equal(productOpportunity(row({ ...p, stock: 0 }), NOW), null);
  // cayendo fuerte: no se promociona
  assert.equal(productOpportunity(row({ ...p, orders7: 50, prev7: 140 }), NOW), null);
});

test("en racha: +50% o más y lo vende poca parte de las tiendas", () => {
  const o = productOpportunity(row({ orders7: 56, prev7: 15, orders30: 168, units30: 200, stores30: 1 }), NOW)!;
  assert.equal(o.kind, "hot");
  assert.match(o.detail, /\+273% en 7 días \(15 → 56 pedidos\) · solo 1 de 30 tiendas/);
  // con poco volumen no hay racha
  assert.notEqual(productOpportunity(row({ orders7: 4, prev7: 1, orders30: 5, units30: 5, stores30: 1 }), NOW)?.kind, "hot");
});

test("bajo movimiento: más de 14 días y menos de 1.5 pedidos por tienda por semana", () => {
  const p = row({ created_at: daysAgo(20), orders7: 3, prev7: 5, orders30: 15, units30: 15, stores30: 18 });
  const o = productOpportunity(p, NOW)!;
  assert.equal(o.kind, "low_movement");
  // 15 pedidos / 18 tiendas / 20 días × 7 = 0.3
  assert.equal(o.detail, "20 días disponible · 18 tiendas lo venden · 0.3 pedidos/tienda/semana");
  // viene creciendo fuerte: no se marca
  assert.equal(productOpportunity(row({ ...p, orders7: 10, prev7: 5 }), NOW), null);
  // más joven que 14 días: todavía no se juzga
  assert.equal(productOpportunity(row({ ...p, created_at: daysAgo(10) }), NOW), null);
  // 1 unidad por pedido y muchas tiendas: oferta y precio primero
  assert.deepEqual(lowMovementCauses(p).map((c) => c.key), ["offer", "price", "creative", "landing", "product"]);
});

test("activo con inventario y sin pedidos en 30 días", () => {
  const o = productOpportunity(row({ created_at: daysAgo(40), stock: 80 }), NOW)!;
  assert.equal(o.kind, "no_orders");
  assert.match(o.detail, /40 días disponible · 80 u\. en inventario/);
  assert.equal(productOpportunity(row({ created_at: daysAgo(5), stock: 80 }), NOW), null); // recién llegado
  assert.equal(productOpportunity(row({ created_at: daysAgo(40), stock: 0 }), NOW), null); // sin inventario
  assert.equal(productOpportunity(row({ created_at: daysAgo(40), status: "Inactivo" }), NOW), null);
});

test("productInsights: una oportunidad por producto, de más a menos urgente", () => {
  const items = productInsights([
    row({ product_key: "low", created_at: daysAgo(30), orders30: 2, units30: 2, stores30: 2, orders7: 1, prev7: 1 }),
    row({ product_key: "hot", orders7: 56, prev7: 15, orders30: 168, units30: 200, stores30: 1 }),
    row({ product_key: "ok", orders7: 100, prev7: 100, orders30: 400, units30: 400, stores30: 20 }),
  ], NOW);
  assert.deepEqual(items.map((i) => [i.product_key, i.kind]), [["hot", "hot"], ["low", "low_movement"]]);
  for (const i of items) assert.ok(i.account_id && i.product_name && i.title && i.detail && i.action && i.priority > 0);
});

test("orden por columna", () => {
  const rows = [row({ product_key: "a", orders30: 10, stores30: 5 }), row({ product_key: "b", orders30: 30, stores30: 1 })];
  assert.deepEqual(sortProducts(rows, "orders30_desc").map((r) => r.product_key), ["b", "a"]);
  assert.deepEqual(sortProducts(rows, "per_store_desc").map((r) => r.product_key), ["b", "a"]);
  assert.deepEqual(sortProducts(rows, "stores_desc").map((r) => r.product_key), ["a", "b"]);
});
