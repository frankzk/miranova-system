import assert from "node:assert/strict";
import { test } from "node:test";
import type { CrossSellItem } from "./cross-sell.ts";
import { allStoreOpportunities, productItems, sortOpportunities, stalledAccounts, storeOpportunities, withCrossSell } from "./opportunities.ts";
import type { StoreRow } from "./stores.ts";

const row = (p: Partial<StoreRow>): StoreRow => ({
  account_id: "a", store_id: "s", account_name: "Drop Honduras", currency: "HNL", name: "Tienda", today: 0, d7: 0, prev7: 0,
  active7: 0, active_prev7: 0, last_at: null, days_since: 0, n30: 0, ticket: null, vendor_per_order: null,
  units_per_order: null, delivered30: 0, failed30: 0, sales30: null, skus30: 0, top_product: null, top_share: null,
  daily: [], ...p,
});

test("las tiendas que se frenaron van primero, y entre ellas la que más pedidos perdió", () => {
  const items = sortOpportunities(storeOpportunities(
    [
      row({ name: "Crece", store_id: "c", d7: 90, prev7: 50, active7: 7, active_prev7: 7 }),
      row({ name: "Cae poco", store_id: "p", d7: 12, prev7: 20, active7: 5, active_prev7: 5, days_since: 0 }),
      row({ name: "Se frenó", store_id: "f", d7: 40, prev7: 100, active7: 4, active_prev7: 7, days_since: 3 }),
    ],
    {},
    () => String,
  ));
  assert.deepEqual(items.map((i) => [i.subject.name, i.kind, i.group]), [
    ["Se frenó", "silent", "contact"],
    ["Cae poco", "volume", "contact"],
    ["Crece", "growth", "grow"],
  ]);
  assert.equal(items[0].meta, "40 pedidos en 7 días (antes 100) · 4/7 días activos");
});

test("si toda la cuenta dejó de vender, se avisa una vez por la cuenta y no por cada tienda", () => {
  const rows = [
    row({ account_id: "sv", account_name: "Drop El Salvador", store_id: "1", name: "A", d7: 0, prev7: 51, active_prev7: 6, days_since: 8 }),
    row({ account_id: "sv", account_name: "Drop El Salvador", store_id: "2", name: "B", d7: 0, prev7: 27, active_prev7: 5, days_since: 8 }),
    row({ account_id: "hn", account_name: "Drop Honduras", store_id: "3", name: "C", d7: 4, prev7: 181, active7: 3, active_prev7: 7, days_since: 3 }),
  ];
  assert.deepEqual(stalledAccounts(rows).map((a) => [a.account_name, a.prev7, a.stores, a.days]), [["Drop El Salvador", 78, 2, 8]]);
  const items = sortOpportunities(allStoreOpportunities(rows, {}, () => String));
  assert.deepEqual(items.map((i) => [i.subject.type, i.subject.name, i.kind]), [
    ["account", "Drop El Salvador", "account_stalled"],
    ["store", "C", "silent"],
  ]);
});

test("venta cruzada: completa la alerta de un solo producto y agrega una sugerencia por tienda", () => {
  const stores = storeOpportunities(
    [row({ name: "Noelia Home", store_id: "n", d7: 49, prev7: 50, active7: 6, active_prev7: 7, n30: 196, skus30: 1, top_product: "Cinturón", top_share: 1 })],
    {},
    () => String,
  );
  const cs = (p: Partial<CrossSellItem>): CrossSellItem => ({
    kind: "cross_sell", account_id: "a", store_id: "z", store_name: "ZONAHN", product_key: "p2", product_name: "Pelador",
    anchor_key: "p1", anchor_name: "DLG", title: "", detail: "3 de 4 tiendas que venden DLG también venden Pelador", action: "Proponerle Pelador", priority: 70, ...p,
  });
  const items = withCrossSell(stores, [
    cs({ kind: "single_product", store_id: "n", store_name: "Noelia Home", product_name: "Cayenne", title: "📦 Noelia Home vende solo 1 producto" }),
    cs({}),
    cs({ product_key: "p3", product_name: "Mini Fan", priority: 60 }), // segunda sugerencia para ZONAHN: se omite
  ], () => "Drop Honduras");
  assert.deepEqual(items.map((i) => [i.subject.name, i.kind, i.action]), [
    ["Noelia Home", "single", "ofrecerle un segundo producto: Cayenne"],
    ["ZONAHN", "cross_sell", "proponerle Pelador"],
  ]);
  assert.equal(items[1].title, "Vende mucho DLG pero nunca probó Pelador");
});

test("productos: en racha y expansión esta semana; bajo movimiento cuando haya tiempo", () => {
  const items = productItems(
    [
      { kind: "low_movement", account_id: "a", product_key: "x", product_name: "X", title: "Bajo movimiento", detail: "", action: "", priority: 40 },
      { kind: "hot", account_id: "a", product_key: "h", product_name: "Hígado", title: "Producto en racha", detail: "", action: "", priority: 85 },
    ],
    () => "Drop Honduras",
  );
  assert.deepEqual(sortOpportunities(items).map((i) => [i.subject.name, i.priority, i.group]), [["Hígado", 2, "product"], ["X", 3, "product"]]);
});
