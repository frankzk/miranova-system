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

test("formato real de Drop: variantes, moneda e imagen genérica", () => {
  const [p] = extractProducts({
    status: "success",
    products: { products: [{
      id: "6a8f", name: "FatBurn Shorts", productCode: null, active: true, price: 0, suggestedPrice: 0, quantity: 0,
      totalAvailable: 116, currencyName: "HNL", imgUrl: "https://boxful.sfo3.digitaloceanspaces.com/avatar.png", images: [],
      variantsCount: 3,
      variants: [
        { id: "v1", sku: "talla-1", name: "TALLA XL", price: 331.7, quantity: 29, productCode: "ID-HD24Q", suggestedPrice: 1110 },
        { id: "v2", sku: "talla-2", name: "TALLA L", price: 320, quantity: 87, productCode: "ID-HD25Q", suggestedPrice: 1090 },
        { id: "v3", sku: "talla-3", name: "TALLA S", price: 330, quantity: 0, deleted: true },
      ],
    }] },
  });
  assert.equal(p.price, 320);
  assert.equal(p.suggested_price, 1090);
  assert.equal(p.stock, 116);
  assert.equal(p.variants_count, 2);
  assert.equal(p.code, "ID-HD24Q");
  assert.equal(p.currency, "HNL");
  assert.equal(p.image_url, null);
  assert.equal(p.status, "Activo");
});
