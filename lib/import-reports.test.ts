import { test } from "node:test";
import assert from "node:assert/strict";
import { lastMonths, monthlySpend, moneyInTransit, productKeyOf, supplierStats, unitCostHistory, type RCost, type RImport, type RItem } from "./import-reports.ts";
import { isLate, staleDays } from "./imports.ts";

const close = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
const imp = (p: Partial<RImport>): RImport => ({
  id: "x", code: "IMP-X", supplier_id: "s1", supplier: "Yiwu", dest_country: "GT", status: "transit",
  ordered_at: null, created_at: "2026-01-01T10:00:00Z", eta: null, arrived_at: null, ...p,
});
const item = (p: Partial<RItem>): RItem => ({ id: "l", import_id: "x", account_id: null, product_external_id: null, name: "Producto", sku: null, qty: 100, unit_cost: 1, ...p });

const imports = [
  imp({ id: "a", code: "IMP-2026-001", ordered_at: "2026-07-01", eta: "2026-07-30", arrived_at: "2026-07-28", status: "in_drop" }), // a tiempo, 27 días
  imp({ id: "b", code: "IMP-2026-002", ordered_at: "2026-08-10", eta: "2026-09-01", arrived_at: "2026-09-12", status: "received" }), // tarde, 33 días
  imp({ id: "c", code: "IMP-2026-003", ordered_at: "2026-09-20", eta: "2026-10-20", status: "transit", dest_country: "CR" }),
  imp({ id: "q", code: "IMP-2026-004", status: "quote", ordered_at: null, created_at: "2026-10-01T10:00:00Z" }), // cotización
  imp({ id: "z", code: "IMP-2026-005", status: "cancelled", ordered_at: "2026-09-05" }),
  imp({ id: "o", code: "IMP-2026-006", supplier_id: "s2", supplier: "Otro", ordered_at: "2026-10-02", status: "paid" }),
];
const items: RItem[] = [
  item({ id: "a1", import_id: "a", account_id: "hn", product_external_id: "p1", name: "Pelador", qty: 100, unit_cost: 2, received_qty: 100, damaged_qty: 0 }),
  item({ id: "b1", import_id: "b", account_id: "hn", product_external_id: "p1", name: "Pelador (nuevo nombre)", qty: 200, unit_cost: 2.2, received_qty: 190, damaged_qty: 10 }),
  item({ id: "c1", import_id: "c", name: "Lámpara LED", qty: 50, unit_cost: 4 }),
  item({ id: "q1", import_id: "q", name: "Taza", qty: 999, unit_cost: 1 }),
  item({ id: "o1", import_id: "o", name: "lampara  led", qty: 10, unit_cost: 5 }),
];
const costs: RCost[] = [
  { import_id: "a", kind: "shipping", amount: 100, allocation: "units" },
  { import_id: "c", kind: "shipping", amount: 50, allocation: "units" },
];

test("alertas: atrasada y sin novedades", () => {
  assert.equal(isLate({ status: "transit", eta: "2026-10-01" }, "2026-10-10"), true);
  assert.equal(isLate({ status: "received", eta: "2026-10-01" }, "2026-10-10"), false);
  assert.equal(isLate({ status: "quote", eta: "2026-10-01" }, "2026-10-10"), false);
  assert.equal(staleDays({ status: "transit" }, "2026-10-01T15:00:00Z", "2026-10-10"), 9);
  assert.equal(staleDays({ status: "customs" }, "2026-10-05T15:00:00Z", "2026-10-10"), null); // 5 días: al día
  assert.equal(staleDays({ status: "production" }, "2026-09-01T15:00:00Z", "2026-10-10"), null); // no viaja todavía
});

test("proveedor: compras, tiempo de entrega, a tiempo, faltantes y productos", () => {
  const s = supplierStats(imports, items, costs).get("s1")!;
  assert.equal(s.imports, 5);
  assert.equal(s.bought, 3); // sin cotización ni cancelada
  assert.equal(s.last, "2026-10-01"); // la cotización también es "última actividad"
  assert.equal(s.units, 350);
  close(s.spent, 200 + 100 + 440 + 200 + 50); // a: 300, b: 440, c: 250
  close(s.leadDays, 30);
  assert.equal(s.leadSamples, 2);
  close(s.onTime, 0.5);
  close(s.lossRate, 20 / 300); // b: faltan 10 + 10 dañadas, sobre 300 contadas
  assert.deepEqual(s.products.map((p) => p.name), ["Pelador (nuevo nombre)", "Pelador", "Lámpara LED"]);
  assert.equal(supplierStats(imports, items, costs).get("s2")!.leadDays, null);
});

test("dinero en camino: lo comprado que no llega, por país", () => {
  const m = moneyInTransit(imports, items, costs, [{ import_id: "c", paid_at: "2026-09-21", amount: 100 }, { import_id: "a", paid_at: "2026-07-02", amount: 300 }]);
  assert.equal(m.count, 2); // c y o (sin cotización, recibidas ni canceladas)
  close(m.total, 250 + 50);
  close(m.paid, 100);
  close(m.due, 200);
  assert.deepEqual(m.byCountry.map((c) => [c.country, c.count]), [["CR", 1], ["GT", 1]]);
});

test("gasto por mes: comprado según el mes del pedido y pagado según el mes del pago", () => {
  const months = lastMonths("2026-10-10", 4);
  assert.deepEqual(months, ["2026-07", "2026-08", "2026-09", "2026-10"]);
  assert.deepEqual(lastMonths("2026-01-15", 3), ["2025-11", "2025-12", "2026-01"]);
  const r = monthlySpend(imports, items, costs, [
    { import_id: "a", paid_at: "2026-07-02", amount: 150 },
    { import_id: "a", paid_at: "2026-08-02", amount: 150 },
    { import_id: "z", paid_at: "2026-09-06", amount: 999 }, // cancelada: no cuenta
  ], months);
  const c = (v: number) => Math.round(v * 100) / 100;
  assert.deepEqual(r.map((x) => [x.month, c(x.bought), c(x.paid), x.imports]), [
    ["2026-07", 300, 150, 1], ["2026-08", 440, 150, 1], ["2026-09", 250, 0, 1], ["2026-10", 50, 0, 1],
  ]);
});

test("historial del costo por unidad: mismo producto de Drop o mismo nombre, del más reciente al más viejo", () => {
  assert.equal(productKeyOf({ account_id: null, product_external_id: null, name: "Lámpara  LED" }), "name:lampara led");
  const h = unitCostHistory(imports, items, costs);
  const pel = h.find((x) => x.key === "hn:p1")!;
  assert.deepEqual(pel.points.map((p) => p.code), ["IMP-2026-002", "IMP-2026-001"]);
  close(pel.last.unit, 440 / 180); // 180 buenas
  close(pel.prev!.unit, 3);
  close(pel.change, 440 / 180 / 3 - 1);
  const lamp = h.find((x) => x.key === "name:lampara led")!;
  assert.equal(lamp.points.length, 2); // nuevo, por nombre, en dos proveedores
  assert.equal(lamp.last.supplier, "Otro");
  assert.ok(!h.some((x) => x.name === "Taza"), "las cotizaciones no cuentan");
});
