import { test } from "node:test";
import assert from "node:assert/strict";
import { importFileProblem, isImportFilePath, landedCosts, marginOf, needsReport, nextCode, recoveryShare, trackingUrl, whatsappMessage } from "./imports.ts";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

const items = [
  { id: "a", qty: 100, unit_cost: 2, unit_weight_kg: 0.5 }, // valor 200, peso 50
  { id: "b", qty: 50, unit_cost: 12, unit_weight_kg: 0.2 }, // valor 600, peso 10
];

test("sin costos extra, el costo por unidad es el del proveedor", () => {
  const r = landedCosts(items, []);
  close(r.items[0].unit, 2);
  close(r.items[1].unit, 12);
  close(r.totals.total, 800);
  assert.equal(r.totals.units, 150);
});

test("reparto por valor, unidades, peso y a un producto", () => {
  const r = landedCosts(items, [
    { kind: "import", amount: 80, allocation: "value" },    // a 20, b 60
    { kind: "shipping", amount: 120, allocation: "weight" }, // a 100, b 20
    { kind: "other", amount: 30, allocation: "units" },     // a 20, b 10
    { kind: "other", amount: 25, allocation: "item", item_id: "b" },
  ]);
  const [a, b] = r.items;
  close(a.import, 20); close(b.import, 60);
  close(a.shipping, 100); close(b.shipping, 20);
  close(a.other, 20); close(b.other, 35);
  close(a.unit, (200 + 20 + 100 + 20) / 100); // 3.40
  close(b.unit, (600 + 60 + 20 + 35) / 50); // 14.30
  close(a.unitParts.shipping, 1);
  // nada se pierde ni se duplica al repartir
  close(r.totals.total, 800 + 80 + 120 + 30 + 25);
  close(a.total + b.total, r.totals.total);
  assert.deepEqual(r.notes, []);
});

test("por peso sin pesos: se reparte por unidades y lo avisa", () => {
  const r = landedCosts([{ id: "a", qty: 10, unit_cost: 1 }, { id: "b", qty: 30, unit_cost: 1 }], [{ kind: "shipping", amount: 40, allocation: "weight" }]);
  close(r.items[0].shipping, 10);
  close(r.items[1].shipping, 30);
  assert.equal(r.notes.length, 1);
});

test("costo asignado a un producto que ya no está: se reparte por valor", () => {
  const r = landedCosts(items, [{ kind: "other", amount: 8, allocation: "item", item_id: "zzz" }]);
  close(r.items[0].other, 2);
  close(r.items[1].other, 6);
  assert.equal(r.notes.length, 1);
});

test("margen frente al precio de venta", () => {
  const m = marginOf(3.4, 10, 100)!;
  close(m.unit, 6.6);
  close(m.pct, 0.66);
  close(m.total, 660);
  assert.equal(m.low, false);
  assert.equal(m.breakEven, 34); // 340 USD / 10 por unidad
  assert.equal(marginOf(9, 10, 1)!.low, true);
  assert.equal(marginOf(3, null, 1), null);
  close(recoveryShare(500, 1000)!, 0.5);
  assert.equal(recoveryShare(500, 0), null);
});

test("código siguiente del año", () => {
  assert.equal(nextCode(2026, []), "IMP-2026-001");
  assert.equal(nextCode(2026, ["IMP-2026-001", "IMP-2026-009", "IMP-2025-044"]), "IMP-2026-010");
});

test("enlace de seguimiento", () => {
  assert.equal(trackingUrl("DHL", "123 456"), "https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=123%20456");
  assert.equal(trackingUrl("fedex", "77"), "https://www.fedex.com/fedextrack/?trknbr=77");
  assert.equal(trackingUrl("Otra", "LX1CN"), "https://t.17track.net/es#nums=LX1CN");
  assert.equal(trackingUrl("DHL", "1", "https://mi-courier.com/t/1"), "https://mi-courier.com/t/1");
  assert.equal(trackingUrl("DHL", ""), null);
});

test("aviso a la bodega", () => {
  const base = { status: "transit", reported_at: null, eta: "2026-10-12" };
  assert.equal(needsReport(base, "2026-10-08"), false); // faltan 4 días
  assert.equal(needsReport(base, "2026-10-09"), true); // faltan 3
  assert.equal(needsReport({ ...base, reported_at: "2026-10-01T00:00:00Z" }, "2026-10-11"), false);
  assert.equal(needsReport({ ...base, status: "received" }, "2026-10-11"), false);
  assert.equal(needsReport({ ...base, eta: null }, "2026-10-11"), false);
});

test("mensaje de WhatsApp", () => {
  const text = whatsappMessage(
    { code: "IMP-2026-003", dest_country: "GT", carrier: "DHL", tracking_number: "99", eta: "2026-10-14", supplier: "Yiwu Co" },
    [{ name: "Pelador", sku: "P1", qty: 200 }, { name: "Mini fan", sku: null, qty: 50 }],
    (c) => (c === "GT" ? "Guatemala" : c),
    "https://x/99",
  );
  assert.match(text, /llega a Guatemala/);
  assert.match(text, /\*IMP-2026-003\* · Yiwu Co/);
  assert.match(text, /Guía: DHL 99/);
  assert.match(text, /Llegada estimada: 14\/10\/2026/);
  assert.match(text, /Productos \(250 u\.\)/);
  assert.match(text, /• 200 × Pelador \(SKU P1\)/);
});

test("archivos permitidos y rutas", () => {
  assert.equal(importFileProblem("application/pdf", "f.pdf", 10), null);
  assert.equal(importFileProblem("", "foto.JPG", 10), null);
  assert.match(importFileProblem("application/pdf", "f.pdf", 10, true)!, /foto/);
  assert.match(importFileProblem("text/plain", "a.txt", 10)!, /PDF/);
  assert.match(importFileProblem("image/png", "a.png", 30 * 1024 * 1024)!, /25 MB/);
  const id = "11111111-2222-4333-8444-555555555555";
  assert.equal(isImportFilePath(`${id}/docs/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.pdf`, id, "docs"), true);
  assert.equal(isImportFilePath(`${id}/items/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.pdf`, id, "docs"), false);
  assert.equal(isImportFilePath(`otro/docs/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.pdf`, id, "docs"), false);
});
