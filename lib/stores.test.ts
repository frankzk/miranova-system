import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyStoreFilters, classify, filterStores, matchesStore, opportunities, parseStoreFilters, periodView, sortLabel, sortStores, storeKey, toContact,
  typicalTickets, withPeriodStores, type StorePeriod, type StoreRow,
} from "./stores.ts";
import { periodParams, periodUnit, prevPhrase, storePeriodChoice } from "./store-period.ts";

const row = (p: Partial<StoreRow>): StoreRow => ({
  account_id: "a", store_id: "s", account_name: "Drop Honduras", currency: "HNL", name: "Tienda", today: 0, d7: 0, prev7: 0,
  active7: 0, active_prev7: 0, last_at: null, days_since: 0, n30: 0, ticket: null, vendor_per_order: null,
  units_per_order: null, delivered30: 0, failed30: 0, sales30: null, skus30: 0, top_product: null, top_share: null,
  daily: [], ...p,
});

test("semáforo según el ritmo de 7 días vs. los 7 anteriores", () => {
  assert.equal(classify(row({ d7: 140, prev7: 100, active7: 7, active_prev7: 7 })), "growing"); // +40%
  assert.equal(classify(row({ d7: 105, prev7: 100, active7: 7, active_prev7: 7 })), "stable"); // +5%
  assert.equal(classify(row({ d7: 80, prev7: 100, active7: 7, active_prev7: 7 })), "declining"); // −20%
  assert.equal(classify(row({ d7: 60, prev7: 100, active7: 7, active_prev7: 7 })), "alert"); // −40%
  assert.equal(classify(row({ d7: 0, prev7: 12, days_since: 9 })), "inactive");
  assert.equal(classify(row({ d7: 8, prev7: 0, active7: 3 })), "new");
});

test("alerta si vendía casi a diario y lleva 2+ días sin pedidos, aunque el % no caiga tanto", () => {
  assert.equal(classify(row({ d7: 90, prev7: 100, active7: 5, active_prev7: 7, days_since: 2 })), "alert");
  // una tienda esporádica sin ventas 2 días no es alerta
  assert.equal(classify(row({ d7: 9, prev7: 10, active7: 3, active_prev7: 3, days_since: 2 })), "stable");
});

test("con poco volumen el % no clasifica (3 → 1 no es −67%)", () => {
  assert.equal(classify(row({ d7: 1, prev7: 3, active7: 1, active_prev7: 2, days_since: 1 })), "stable");
});

test("oportunidades: caída, ticket bajo, pocas unidades, entrega baja", () => {
  const typical = typicalTickets([
    row({ account_id: "a", ticket: 250, n30: 50 }),
    row({ account_id: "a", ticket: 260, n30: 40 }),
    row({ account_id: "a", ticket: 175, n30: 30 }),
  ]).a;
  assert.equal(typical, 250);
  const ops = opportunities(
    row({ d7: 66, prev7: 100, active7: 7, active_prev7: 7, n30: 300, ticket: 175, units_per_order: 1.08, delivered30: 50, failed30: 50 }),
    typical,
    (n) => `L ${n}`,
  ).map((o) => o.kind);
  assert.deepEqual(ops, ["volume", "ticket", "units", "delivery"]);
});

test("ordenar por mayor caída pesa los pedidos perdidos, y contactar hoy toma las peores", () => {
  const a = row({ name: "A", d7: 10, prev7: 40, active_prev7: 7, active7: 5 }); // −30 pedidos
  const b = row({ name: "B", d7: 2, prev7: 8, active_prev7: 4, active7: 2 }); // −6
  const c = row({ name: "C", d7: 50, prev7: 40, active_prev7: 7, active7: 7 }); // crece
  assert.deepEqual(sortStores([b, c, a], "drop").map((s) => s.name), ["A", "B", "C"]);
  assert.deepEqual(toContact([c, b, a]).map((s) => s.name), ["A", "B"]);
});

test("crecimiento fuerte, producto ganador y tienda de un solo producto", () => {
  const kinds = (p: Partial<StoreRow>) => opportunities(row(p), null, String).map((o) => o.kind);
  assert.deepEqual(kinds({ d7: 76, prev7: 50, active7: 7, active_prev7: 7 }), ["growth"]); // +52%
  assert.deepEqual(kinds({ d7: 8, prev7: 4, active7: 5, active_prev7: 4 }), []); // +100% pero poco volumen
  assert.deepEqual(kinds({ d7: 49, prev7: 50, n30: 196, skus30: 1, top_product: "Cinturón", top_share: 1 }), ["single"]);
  assert.deepEqual(kinds({ d7: 10, prev7: 10, n30: 40, skus30: 1, top_product: "Cinturón", top_share: 1 }), []); // 1.4/día: aún no
  assert.deepEqual(kinds({ d7: 460, prev7: 450, n30: 2000, skus30: 11, top_product: "DLG", top_share: 0.93 }), ["winner"]);
  assert.deepEqual(kinds({ d7: 460, prev7: 450, n30: 2000, skus30: 11, top_product: "DLG", top_share: 0.55 }), []);
});

test("búsqueda de tienda por nombre: sin mayúsculas ni tildes, todas las palabras", () => {
  assert.equal(matchesStore("Velora Honduras", "velora"), true);
  assert.equal(matchesStore("Velora Honduras", "  hond   VELORA "), true);
  assert.equal(matchesStore("Tienda Económica", "economica"), true);
  assert.equal(matchesStore("Velora Honduras", "velora guatemala"), false);
  assert.equal(matchesStore("Velora Honduras", ""), true);
  assert.equal(matchesStore("Velora Honduras", undefined), true);
});

test("buscador de tiendas: elegidas de la lista más las que coinciden con el texto", () => {
  const a = row({ account_id: "hn", store_id: "1", name: "MercaGo HN" });
  const b = row({ account_id: "gt", store_id: "1", name: "MercaGo HN" });
  const c = row({ account_id: "hn", store_id: "2", name: "Velora Honduras" });
  const d = row({ account_id: "hn", store_id: "name:Nutralix", name: "Nutralix" });
  const all = [a, b, c, d];
  assert.equal(storeKey(d), "hn:name:Nutralix");
  // sin filtros: todas
  assert.deepEqual(filterStores(all, {}), all);
  assert.deepEqual(filterStores(all, { keys: [], q: "  " }), all);
  // elegir la misma tienda en una sola cuenta
  assert.deepEqual(filterStores(all, { keys: [storeKey(b)] }), [b]);
  // varias elegidas
  assert.deepEqual(filterStores(all, { keys: [storeKey(c), storeKey(d)] }), [c, d]);
  // elegidas + texto
  assert.deepEqual(filterStores(all, { keys: [storeKey(d)], q: "velora" }), [c, d]);
  // solo texto: las dos cuentas
  assert.deepEqual(filterStores(all, { q: "mercago" }), [a, b]);
  // una elegida que ya no existe no trae nada
  assert.deepEqual(filterStores(all, { keys: ["xx:9"] }), []);
});

test("filtros de la URL de Salud de tiendas: los mismos para la página y el Excel", () => {
  const f = parseStoreFilters({ h: "alert", g: "con", q: " velora ", t: ["hn:1", "hn:1", " gt:2 "], sort: "ticket_desc" });
  assert.deepEqual(f, { h: "alert", g: "con", q: "velora", t: ["hn:1", "gt:2"], sort: "ticket_desc" });
  assert.deepEqual(parseStoreFilters({ h: "otra", g: "x", sort: "nada" }), { h: undefined, g: undefined, q: undefined, t: [], sort: "d7_desc" });

  const a = row({ account_id: "hn", store_id: "1", name: "Velora", d7: 3 });
  const b = row({ account_id: "hn", store_id: "2", name: "Nutralix", d7: 9 });
  const c = row({ account_id: "gt", store_id: "3", name: "Velora GT", d7: 5 });
  const grupo = (s: StoreRow) => s.store_id !== "2";
  assert.deepEqual(applyStoreFilters([a, b, c], parseStoreFilters({}), grupo), [b, c, a]);
  assert.deepEqual(applyStoreFilters([a, b, c], parseStoreFilters({ q: "velora" }), grupo), [c, a]);
  assert.deepEqual(applyStoreFilters([a, b, c], parseStoreFilters({ g: "sin" }), grupo), [b]);
  assert.deepEqual(applyStoreFilters([a, b, c], parseStoreFilters({ t: "hn:2" }), grupo), [b]);
});

const per = (p: Partial<StorePeriod>): StorePeriod => ({
  account_id: "a", store_id: "s", name: "Tienda", account_name: "Drop Honduras", currency: "HNL", orders: 0, prev: 0, active: 0,
  ticket: null, vendor_per_order: null, units_per_order: null, skus: 0, top_product: null, top_share: null, last_at: null, ...p,
});

test("período elegido: la tabla muestra sus cifras y el estado sigue siendo el de la semana", () => {
  // vendía seguido y se frenó esta semana (alerta), pero en 30 días hizo 90 pedidos (+50% vs. los 30 anteriores)
  const health = [row({ store_id: "x", name: "Velora", d7: 2, prev7: 30, active7: 1, active_prev7: 7, days_since: 3, ticket: 40, skus30: 3 })];
  const period = [per({ store_id: "x", orders: 90, prev: 60, active: 24, ticket: 35, units_per_order: 1.4, skus: 5, top_product: "Gotas", top_share: 0.6 })];
  const all = withPeriodStores(health, period);
  assert.equal(all, health); // ninguna tienda nueva
  const shown = periodView(period)(all[0]);
  assert.equal(shown.d7, 90);
  assert.equal(shown.prev7, 60);
  assert.equal(shown.active7, 24);
  assert.equal(shown.ticket, 35);
  assert.equal(shown.skus30, 5);
  assert.equal(shown.days_since, 3); // la última venta no cambia con el período
  assert.equal(classify(all[0]), "alert");
  // los filtros miran el estado de la fila de salud, y se ordena por las cifras del período
  const f = parseStoreFilters({ h: "alert" });
  assert.deepEqual(applyStoreFilters(all, f, () => false, periodView(period)).map((s) => s.d7), [90]);
  // una tienda sin pedidos en el período sale con ceros
  const quiet = periodView([])(row({ d7: 5, prev7: 4, active7: 3, ticket: 20 }));
  assert.deepEqual([quiet.d7, quiet.prev7, quiet.active7, quiet.ticket], [0, 0, 0, null]);
});

test("período elegido: tiendas que vendieron en el período pero no en 60 días", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");
  const all = withPeriodStores([row({ store_id: "x" })], [per({ store_id: "x" }), per({ store_id: "old", name: "Antigua", orders: 12, last_at: "2026-07-02T12:00:00Z" })], now);
  assert.equal(all.length, 2);
  const old = all[1];
  assert.equal(old.name, "Antigua");
  assert.equal(old.days_since, 102);
  assert.equal(old.daily.length, 14);
  assert.equal(classify(old), "inactive");
});

test("período elegido desde la URL", () => {
  const tz = "America/Tegucigalpa";
  const def = storePeriodChoice({}, tz);
  assert.equal(def.custom, false);
  assert.equal(def.days, 7);
  assert.deepEqual(periodParams(def), { r: undefined, from: undefined, to: undefined });
  assert.equal(periodUnit(def), "7 d");
  const m = storePeriodChoice({ r: "30" }, tz);
  assert.deepEqual([m.custom, m.days, periodUnit(m)], [true, 30, "30 d"]);
  assert.deepEqual(periodParams(m), { r: "30", from: undefined, to: undefined });
  const c = storePeriodChoice({ from: "2026-09-01", to: "2026-09-15" }, tz);
  assert.deepEqual([c.custom, c.days, c.range.id], [true, 15, "custom"]);
  assert.deepEqual(periodParams(c), { r: undefined, from: "2026-09-01", to: "2026-09-15" });
  assert.equal(storePeriodChoice({ r: "hoy" }, tz).days, 1);
  assert.equal(prevPhrase(1), "vs. el día anterior");
  assert.equal(prevPhrase(30), "vs. los 30 días anteriores");
  assert.equal(sortLabel("d7_desc", "30 días"), "Más pedidos (30 días)");
  assert.equal(sortLabel("ticket_desc", "30 días"), "Ticket más alto");
});
