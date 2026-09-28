import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, matchesStore, opportunities, sortStores, toContact, typicalTickets, type StoreRow } from "./stores.ts";

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
