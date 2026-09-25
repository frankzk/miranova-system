import { test } from "node:test";
import assert from "node:assert/strict";
import { extractProducts } from "./products.ts";

test("extrae productos de una respuesta paginada", () => {
  const payload = {
    data: {
      items: [
        { id: "p1", shortId: "ID-Z1GIC", name: "Klenvas - Urocontrol 60 Capsulas", sku: "38182608", status: "active", vendorPrice: 249.31, images: [{ url: "https://img/1.png" }], warehouses: [{ stock: 60 }, { stock: 35 }], createdAt: "2026-09-04T10:00:00Z" },
        { _id: "p2", title: "MINI FAN", sku: "MINI.FAN", isActive: false, price: "292.11", totalStock: 448 },
      ],
      total: 2,
    },
  };
  const [a, b] = extractProducts(payload);
  assert.equal(a.external_id, "p1");
  assert.equal(a.code, "ID-Z1GIC");
  assert.equal(a.status, "Activo");
  assert.equal(a.price, 249.31);
  assert.equal(a.stock, 95);
  assert.equal(a.image_url, "https://img/1.png");
  assert.equal(b.name, "MINI FAN");
  assert.equal(b.status, "Inactivo");
  assert.equal(b.price, 292.11);
  assert.equal(b.stock, 448);
});

test("no confunde órdenes con productos", () => {
  assert.deepEqual(extractProducts({ data: [{ id: "o1", name: "x", orderInfo: {}, productSnapshots: [], customer: {} }] }), []);
});
