import assert from "node:assert/strict";
import { test } from "node:test";
import type { MatrixData } from "./cross-sell.ts";
import {
  compareRows, complements, normalizeCompare, productFocus, productMove, sortRows, storeHabits, storeTrend, trendCounts, type CmpData,
} from "./store-compare.ts";

const A = "acc";
const START = "2026-10-01T06:00:00.000Z";
const OLD = "2026-05-01T00:00:00Z";

const store = (id: string, orders: number, orders_prev: number, extra: Record<string, unknown> = {}) => ({
  account_id: A, store_id: id, name: `Tienda ${id}`, orders, orders_prev, orders90: orders + orders_prev, skus: 1, skus_prev: 1,
  active_days: Math.min(orders, 30), units: orders, sales: orders * 500, last_at: "2026-10-28", today: "2026-10-30",
  fu_at: null, fu_before: null, fu_after: null, ...extra,
});
const cell = (sid: string, pk: string, n: number, p: number, n90 = n + p) => ({ account_id: A, store_id: sid, product_key: pk, n, p, n90, last_at: "2026-10-20" });
const product = (pk: string, orders: number, orders_prev: number, orders90 = orders + orders_prev) => ({
  account_id: A, product_key: pk, name: `Prod ${pk}`, orders, orders_prev, orders90, stores90: 1, stores: 1, stores_prev: 1,
});

const DATA: CmpData = normalizeCompare({
  days: 30,
  accounts: [{ account_id: A, account_name: "Drop Honduras", currency: "HNL" }],
  stores: [
    store("cae", 20, 40),
    store("frena", 0, 12),
    store("sube", 30, 10, { fu_at: "2026-10-15", fu_before: 3, fu_after: 9 }),
    store("vuelve", 6, 0),
    store("nueva", 8, 0),
    store("chica", 2, 3),
    store("igual", 10, 11),
  ],
  products: [product("cinturon", 60, 50), product("pelador", 20, 30), product("pulsera", 5, 0), product("gotas", 0, 0, 12)],
  cells: [
    cell("cae", "cinturon", 15, 20), cell("cae", "pelador", 0, 20),
    cell("frena", "pelador", 0, 12),
    cell("sube", "cinturon", 25, 10), cell("sube", "pulsera", 5, 0), cell("sube", "gotas", 0, 0, 6),
    cell("vuelve", "cinturon", 6, 0, 6),
    cell("nueva", "cinturon", 8, 0), cell("nueva", "gotas", 0, 0, 6),
    cell("igual", "cinturon", 6, 6), cell("igual", "pelador", 4, 5),
  ],
} as unknown as MatrixData);
const FIRST = new Map<string, string | null>([[`${A}|nueva`, "2026-10-12T15:00:00+00:00"], [`${A}|vuelve`, OLD]]);
const F = { periodStart: START, firstAt: FIRST };

test("estado de cada tienda contra el período anterior", () => {
  const { rows } = compareRows(DATA, A, F);
  const trend = Object.fromEntries(rows.map((r) => [r.store.store_id, r.trend]));
  assert.deepEqual(trend, { cae: "falling", frena: "stopped", sube: "growing", vuelve: "back", nueva: "new", chica: "low", igual: "steady" });
  assert.deepEqual(trendCounts(rows), { falling: 1, stopped: 1, growing: 1, back: 1, new: 1, steady: 1, low: 1 });
  // con un solo pedido tras un período vacío es poco volumen, no "volvió"
  assert.equal(storeTrend({ orders: 1, orders_prev: 0 }, OLD, START), "low");
  // con 2 pedidos antes y 0 ahora no alcanza para "se frenó"
  assert.equal(storeTrend({ orders: 0, orders_prev: 2 }, OLD, START), "low");
});

test("columnas: productos con pedidos en alguno de los dos períodos; celdas ahora y antes", () => {
  const { products, rows } = compareRows(DATA, A, F);
  assert.deepEqual(products.map((p) => p.product_key), ["cinturon", "pelador", "pulsera"]);
  const cae = rows.find((r) => r.store.store_id === "cae")!;
  assert.deepEqual(cae.cells, [{ n: 15, p: 20 }, { n: 0, p: 20 }, { n: 0, p: 0 }]);
  assert.equal(cae.delta, -20);
  assert.equal(cae.change, -0.5);
  // producto principal y dominante
  const sube = rows.find((r) => r.store.store_id === "sube")!;
  assert.deepEqual([sube.top, sube.dominant], [0, true]);
});

test("filtros: producto, búsqueda y orden por caída o crecimiento", () => {
  assert.deepEqual(compareRows(DATA, A, { ...F, product: "pelador" }).rows.map((r) => r.store.store_id).sort(), ["cae", "frena", "igual"]);
  assert.deepEqual(compareRows(DATA, A, { ...F, q: "VUÉLVE" }).rows.map((r) => r.store.store_id), ["vuelve"]);
  const { rows } = compareRows(DATA, A, F);
  assert.deepEqual(sortRows(rows, "caida").slice(0, 2).map((r) => r.store.store_id), ["cae", "frena"]);
  assert.equal(sortRows(rows, "subida")[0].store.store_id, "sube");
});

test("qué ofrecer: lo que venden sus pares con el mismo producto principal", () => {
  // 4 tiendas más venden cinturón: 2 también pelador y 2 gotas (empate: primero el de más pedidos); pulsera, 1 sola
  const offer = complements(DATA, A, "vuelve");
  assert.deepEqual(offer.map((o) => o.product_key), ["pelador", "gotas"]);
  assert.match(offer[0].reason, /^2 de 4 tiendas que venden Prod cinturon/);
  // sin pares: lo más vendido de la cuenta que no ha pedido
  const solo = complements(DATA, A, "chica");
  assert.equal(solo[0].share, null);
  assert.match(solo[0].reason, /más vendido/);
});

test("hábitos: ritmo, productos que dejó y efecto del último contacto", () => {
  const h = storeHabits(DATA, A, "cae", F)!;
  assert.equal(h.perDay, 20 / 30);
  assert.deepEqual(h.dropped.map((d) => d.product_key), ["pelador"]);
  assert.deepEqual(h.products.map((p) => [p.product_key, p.move]), [["cinturon", "down"], ["pelador", "dropped"]]);
  assert.equal(h.ticket, 500);
  assert.equal(h.daysSince, 2);
  const s = storeHabits(DATA, A, "sube", F)!;
  assert.deepEqual(s.impact, { at: "2026-10-15", before: 3, after: 9, ready: true, daysLeft: 0, change: 2 });
  assert.equal(productMove(3, 3), "same");
});

test("producto: quién lo dejó, lo empezó, bajó o subió", () => {
  const f = productFocus(DATA, A, "pelador")!;
  assert.deepEqual(f.dropped.map((d) => d.store.store_id), ["cae", "frena"]);
  assert.deepEqual(f.down.map((d) => d.store.store_id), ["igual"]);
  const c = productFocus(DATA, A, "cinturon")!;
  assert.deepEqual(c.started.map((d) => d.store.store_id), ["nueva", "vuelve"]);
  assert.deepEqual(c.up.map((d) => d.store.store_id), ["sube"]);
});

test("sin la migración nueva: sin período anterior ni contactos, sin romperse", () => {
  const d = normalizeCompare({
    days: 7, accounts: [], products: [{ account_id: A, product_key: "x", name: "X", orders: 3, orders90: 9, stores90: 2 }],
    stores: [{ account_id: A, store_id: "s", name: "S", orders: 3, orders90: 9, skus: 1 }],
    cells: [{ account_id: A, store_id: "s", product_key: "x", n: 3, n90: 9 }],
  });
  assert.deepEqual([d.stores[0].orders_prev, d.stores[0].fu_before, d.cells[0].p, d.products[0].stores], [0, null, 0, 0]);
});
