import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allInDrop, dropState, goodUnits, importChecklist, importFileProblem, importOrders, importsDigest, isImportFilePath, landedCosts, marginOf, matchNewProduct,
  needsReport, nextCode, receptionSummary, recoveryShare, trackingUrl, whatsappMessage, type DropState,
} from "./imports.ts";
import { trackOrders } from "./inventory.ts";

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

test("recepción: el costo por unidad se reparte sobre las unidades buenas", () => {
  const got = [
    { id: "a", qty: 100, unit_cost: 2, unit_weight_kg: 0.5, received_qty: 95, damaged_qty: 5 }, // 90 buenas
    { id: "b", qty: 50, unit_cost: 12, unit_weight_kg: 0.2, received_qty: null },               // sin contar: 50
  ];
  const r = landedCosts(got, [{ kind: "shipping", amount: 120, allocation: "weight" }]); // a 100, b 20 (sobre lo pedido)
  close(r.items[0].total, 300);
  assert.equal(r.items[0].good, 90);
  close(r.items[0].unit, 300 / 90);
  close(r.items[1].unit, 620 / 50);
  assert.equal(r.totals.units, 150);
  assert.equal(r.totals.good, 140);
  // todo dañado: se avisa y se muestra sobre lo pedido
  const lost = landedCosts([{ id: "x", qty: 10, unit_cost: 3, received_qty: 10, damaged_qty: 10 }], []);
  close(lost.items[0].unit, 3);
  assert.equal(lost.notes.length, 1);

  const sum = receptionSummary([
    { qty: 100, received_qty: 95, damaged_qty: 5 },
    { qty: 50, received_qty: 52, damaged_qty: 0 },
    { qty: 20, received_qty: null },
  ]);
  assert.deepEqual(
    [sum.complete, sum.started, sum.lines, sum.ordered, sum.received, sum.damaged, sum.missing, sum.extra, sum.good],
    [false, true, 2, 170, 147, 5, 5, 2, 90 + 52 + 20],
  );
  assert.equal(goodUnits({ qty: 7 }), 7);
});

test("importaciones en camino para Inventario: desde que se pagan, con las unidades buenas", () => {
  const imps = [
    { id: "i1", code: "IMP-2026-001", supplier: "Yiwu", status: "transit", ordered_at: "2026-09-01", created_at: "2026-08-30T10:00:00Z", eta: "2026-10-20", arrived_at: null },
    { id: "i2", code: "IMP-2026-002", supplier: null, status: "quote", ordered_at: null, created_at: "2026-09-10T10:00:00Z", eta: null, arrived_at: null },
    { id: "i3", code: "IMP-2026-003", supplier: null, status: "in_drop", ordered_at: null, created_at: "2026-08-01T10:00:00Z", eta: null, arrived_at: "2026-09-02" },
  ];
  const its = [
    { id: "l1", import_id: "i1", account_id: "hn", product_external_id: "p1", qty: 300 },
    { id: "l2", import_id: "i1", account_id: null, product_external_id: null, qty: 50 }, // nuevo sin enlazar
    { id: "l3", import_id: "i1", account_id: "hn", product_external_id: "p2", qty: 100, received_qty: 90, damaged_qty: 10 },
    { id: "l4", import_id: "i2", account_id: "hn", product_external_id: "p1", qty: 999 }, // cotización: no cuenta
    { id: "l5", import_id: "i3", account_id: "hn", product_external_id: "p3", qty: 40 },
  ];
  const o = importOrders(imps, its);
  assert.deepEqual(o.map((x) => [x.id, x.units, x.min_units, x.ordered_at, x.eta]), [
    ["imp:l1", 300, 150, "2026-09-01T12:00:00Z", "2026-10-20"],
    ["imp:l3", 80, 40, "2026-09-01T12:00:00Z", "2026-10-20"],
    ["imp:l5", 40, 20, "2026-08-01T10:00:00Z", null],
  ]);
  assert.equal(o[0].note, "IMP-2026-001 · Yiwu");
  assert.equal(o[2].import?.declared_at, "2026-09-02T12:00:00Z");

  // estado frente a Drop: l1 entró (se vio), l3 sigue en camino, l2 sin enlazar
  const tracked = trackOrders(o, [{ at: "2026-10-18T15:00:00Z", units: 298, reason: "STOCK_REQUEST" }], "2026-10-21");
  const t = new Map(tracked.map((x) => [x.import!.item_id, x]));
  const states = new Map<string, DropState>(its.map((i) => [i.id, dropState(i, t.get(i.id))]));
  assert.deepEqual(states.get("l1"), { kind: "in", at: "2026-10-18T15:00:00Z", units: 298, seen: true });
  assert.deepEqual(states.get("l3"), { kind: "coming", late: true });
  assert.deepEqual(states.get("l2"), { kind: "unlinked" });
  assert.deepEqual(states.get("l4"), { kind: "waiting" });
  assert.deepEqual(states.get("l5"), { kind: "in", at: "2026-09-02T12:00:00Z", units: 40, seen: false });
  // todavía no entró todo (falta l3 y hay uno sin enlazar); con solo l1, sí
  assert.equal(allInDrop(its.slice(0, 3), states).done, false);
  assert.deepEqual(allInDrop([its[0]], states), { done: true, at: "2026-10-18T15:00:00Z", units: 298 });
  // marcada a mano como ingresada no cuenta como "vista" para avanzar sola
  assert.equal(allInDrop([its[4]], states).done, false);
});

test("producto nuevo: se enlaza por SKU o nombre, solo si hay uno", () => {
  const prods = [
    { id: 1, name: "Lámpara LED Plegable", sku: "LAMP-01", code: "ID-AAA" },
    { id: 2, name: "Organizador de cables", sku: null, code: "ID-BBB" },
    { id: 3, name: "Organizador de Cables", sku: null, code: "ID-CCC" },
    { id: 4, name: "Taza", sku: "TZ", code: null },
  ];
  assert.equal(matchNewProduct({ name: "otra cosa", sku: " lamp-01 " }, prods)?.id, 1);
  assert.equal(matchNewProduct({ name: "x", sku: "id-bbb" }, prods)?.id, 2);
  assert.equal(matchNewProduct({ name: "lampara led plegable", sku: null }, prods)?.id, 1);
  assert.equal(matchNewProduct({ name: "Organizador de cables", sku: null }, prods), null); // dos iguales
  assert.equal(matchNewProduct({ name: "Taza", sku: null }, prods), null); // nombre muy corto
  assert.equal(matchNewProduct({ name: "Lámpara LED Plegable", sku: "OTRO" }, prods)?.id, 1); // SKU sin coincidencia: por nombre
});

test("resumen diario: atrasadas, llegan esta semana y sin avisar a la bodega", () => {
  const base = { supplier: null, dest_country: "GT", reported_at: null, units: 100 };
  const d = importsDigest([
    { ...base, id: "1", code: "A", status: "transit", eta: "2026-10-08" },                       // atrasada
    { ...base, id: "2", code: "B", status: "customs", eta: "2026-10-12", reported_at: "2026-10-09" }, // esta semana, reportada
    { ...base, id: "3", code: "C", status: "transit", eta: "2026-10-11" },                       // esta semana, sin avisar
    { ...base, id: "4", code: "D", status: "transit", eta: "2026-10-30" },                       // más adelante
    { ...base, id: "5", code: "E", status: "received", eta: "2026-10-01" },                      // ya llegó
    { ...base, id: "6", code: "F", status: "quote", eta: "2026-10-09" },                         // cotización
  ], "2026-10-10");
  assert.deepEqual(d.late.map((i) => i.code), ["A"]);
  assert.deepEqual(d.week.map((i) => i.code), ["C", "B"]);
  assert.deepEqual(d.unreported.map((i) => i.code), ["A", "C"]);
});

test("checklist: factura comercial subida y tracking (número o guía subida)", () => {
  const done = (docs: string[], tracking_number: string | null) => importChecklist({ docs, tracking_number }).map((c) => [c.id, c.done]);
  assert.deepEqual(done([], null), [["invoice", false], ["tracking", false]]);
  // la proforma no cuenta como factura comercial; un número vacío no es tracking
  assert.deepEqual(done(["proforma", "payment"], "  "), [["invoice", false], ["tracking", false]]);
  assert.deepEqual(done(["invoice"], "DHL 9579399841"), [["invoice", true], ["tracking", true]]);
  assert.deepEqual(done(["tracking"], null), [["invoice", false], ["tracking", true]]);
});
