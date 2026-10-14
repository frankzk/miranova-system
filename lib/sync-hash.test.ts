import assert from "node:assert/strict";
import { test } from "node:test";
import { changedSince, syncHash } from "./sync-hash.ts";

const order = {
  external_id: "A1",
  status: "Entregado",
  total: 450,
  raw: { orderInfo: { status: "DELIVERED", updatedAt: "2026-10-14T10:00:00Z" }, customer: { name: "Ana" } },
  items: [{ sku: "X", quantity: 2, price: 225 }],
};

test("el mismo contenido da la misma huella aunque cambie el orden de las claves", () => {
  const reordered = {
    items: [{ price: 225, quantity: 2, sku: "X" }],
    raw: { customer: { name: "Ana" }, orderInfo: { updatedAt: "2026-10-14T10:00:00Z", status: "DELIVERED" } },
    total: 450,
    status: "Entregado",
    external_id: "A1",
  };
  assert.equal(syncHash(order), syncHash(reordered));
});

test("cualquier cambio en la orden, sus productos o la respuesta de Drop cambia la huella", () => {
  const h = syncHash(order);
  assert.notEqual(syncHash({ ...order, status: "Devuelto" }), h);
  assert.notEqual(syncHash({ ...order, items: [{ sku: "X", quantity: 3, price: 225 }] }), h);
  assert.notEqual(syncHash({ ...order, raw: { ...order.raw, shipping: { trackingUrl: "https://t/1" } } }), h);
  assert.notEqual(syncHash({ ...order, total: "450" }), h); // número y texto no son lo mismo
});

test("un campo ausente equivale a uno indefinido, pero no a uno vacío", () => {
  assert.equal(syncHash({ a: 1, b: undefined }), syncHash({ a: 1 }));
  assert.notEqual(syncHash({ a: 1, b: null }), syncHash({ a: 1 }));
  assert.notEqual(syncHash({ a: 1, b: "" }), syncHash({ a: 1, b: null }));
});

test("el orden de los productos sí importa (es su posición en la orden)", () => {
  assert.notEqual(syncHash({ items: [1, 2] }), syncHash({ items: [2, 1] }));
});

test("sincronizaciones seguidas: la primera escribe todo, la siguiente nada y luego solo lo que cambió", () => {
  const page = [
    { external_id: "A1", status: "Pendiente", total: 100 },
    { external_id: "A2", status: "En tránsito", total: 200 },
  ];
  const key = (o: { external_id: string }) => o.external_id;

  const first = changedSince(page, key, new Map()); // filas nuevas (o de antes de la huella: null)
  assert.deepEqual(first.changed.map(key), ["A1", "A2"]);

  const saved = new Map<string, string | null>(first.hashes);
  assert.deepEqual(changedSince(page, key, saved).changed, []);

  const next = [page[0], { ...page[1], status: "Entregado" }];
  const third = changedSince(next, key, saved);
  assert.deepEqual(third.changed.map(key), ["A2"]);
  assert.notEqual(third.hashes.get("A2"), saved.get("A2"));
  assert.equal(third.hashes.get("A1"), saved.get("A1"));

  assert.deepEqual(changedSince(page, key, new Map([["A1", null], ["A2", saved.get("A2")!]])).changed.map(key), ["A1"]);
});
