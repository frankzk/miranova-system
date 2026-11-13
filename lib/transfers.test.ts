import assert from "node:assert/strict";
import { test } from "node:test";
import type { LabPurchase } from "./lab-purchases.ts";
import type { StoreRequest } from "./store-requests.ts";
import {
  byDestination, cleanArrival, cleanHeader, cleanLine, cleanPoint, compareSize, dayLabel, defaultDest, lineLabel, productVariants, variantGrid, defaultOrigin, destinationsFor, isLate, labName, labSource, nextTransferCode,
  pendingToSend, pointCode, requestSource, routeSummary, sentBySource, shortage, statusAfterArrivals, totals,
  type TransferFull, type TransferItem, type TransferPoint,
} from "./transfers.ts";

const P = (code: string, country: string, extra: Partial<TransferPoint> = {}): TransferPoint => ({
  id: code, code, name: code, country, city: null, goods: "both", is_origin: false, is_destination: true, accounts: [], active: true, position: 0, ...extra,
});
const POINTS: TransferPoint[] = [
  P("boxful_gt", "GT", { is_origin: true, accounts: ["miranova_gt"], position: 10 }),
  P("moi_gt", "GT", { is_origin: true, goods: "maquila", accounts: ["dropi_gt"], position: 20 }),
  P("mireva_tgu", "HN", { accounts: ["mireva_hn"], position: 30 }),
  P("miranova_sps", "HN", { accounts: ["miranova_hn"], position: 40 }),
  P("alex_sv", "SV", { goods: "maquila", accounts: ["miranova_sv"], position: 50 }),
  P("boxful_sv", "SV", { goods: "import", position: 60 }),
  P("bodega_cr", "CR", { is_origin: true, accounts: ["miranova_cr", "mireva_cr", "dropi_cr"], position: 70 }),
  P("vieja_hn", "HN", { active: false, position: 1 }),
];

const item = (over: Partial<TransferItem>): TransferItem => ({
  id: "i", transfer_id: "t", dest_id: "miranova_sps", kind: "import", name: "Producto", sku: null, account_id: null, product_external_id: null, image_url: null,
  qty: 10, source: null, received_qty: null, damaged_qty: 0, received_note: null, position: 0, ...over,
});
const transfer = (over: Partial<TransferFull>): TransferFull => ({
  id: "t", code: "TR-2026-001", origin_id: "boxful_gt", dest_country: "HN", carrier: null, reference: null, status: "transit", shipped_at: "2026-11-01",
  eta: "2026-11-08", notes: null, created_by: null, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", items: [], arrivals: [], ...over,
});

test("código del traslado: el siguiente del año", () => {
  assert.equal(nextTransferCode(2026, []), "TR-2026-001");
  assert.equal(nextTransferCode(2026, ["TR-2026-009", "TR-2025-120", "IMP-2026-050"]), "TR-2026-010");
});

test("rutas: destinos del país por clase y orígenes propuestos", () => {
  assert.deepEqual(destinationsFor(POINTS, "HN").map((p) => p.code), ["mireva_tgu", "miranova_sps"]);
  assert.equal(defaultDest(POINTS, "SV", "maquila")?.code, "alex_sv");
  assert.equal(defaultDest(POINTS, "SV", "import")?.code, "boxful_sv");
  assert.equal(defaultOrigin(POINTS, "import", "HN")?.code, "boxful_gt");
  assert.equal(defaultOrigin(POINTS, "maquila", "HN")?.code, "moi_gt");
  // a El Salvador todo sale de Boxful Guatemala, también lo maquilado
  assert.equal(defaultOrigin(POINTS, "maquila", "SV")?.code, "boxful_gt");
});

test("merma, totales y llegada por bodega", () => {
  assert.equal(shortage(item({ qty: 10, received_qty: 8 })), 2);
  assert.equal(shortage(item({ qty: 10, received_qty: 12 })), 0);
  assert.equal(shortage(item({ qty: 10 })), null);
  const t = transfer({
    items: [
      item({ id: "a", dest_id: "miranova_sps", qty: 100, received_qty: 97, damaged_qty: 2 }),
      item({ id: "b", dest_id: "mireva_tgu", qty: 50 }),
      item({ id: "c", dest_id: "miranova_sps", qty: 30, received_qty: 30 }),
    ],
    arrivals: [{ transfer_id: "t", dest_id: "miranova_sps", arrived_at: "2026-11-07", note: null, received_by: null }],
  });
  assert.deepEqual(totals(t.items), { lines: 3, sent: 180, received: 127, damaged: 2, shortage: 3, counted: 2 });
  const groups = byDestination(t, POINTS);
  assert.deepEqual(groups.map((g) => [g.point.code, g.items.length, !!g.arrival]), [["mireva_tgu", 1, false], ["miranova_sps", 2, true]]);
  assert.equal(statusAfterArrivals(t), "transit");
  assert.equal(statusAfterArrivals({ ...t, arrivals: [...t.arrivals, { transfer_id: "t", dest_id: "mireva_tgu", arrived_at: "2026-11-09", note: null, received_by: null }] }), "arrived");
  assert.equal(statusAfterArrivals({ ...t, status: "cancelled" }), "cancelled");
  assert.equal(isLate(t, "2026-11-09"), true);
  assert.equal(isLate(t, "2026-11-08"), false);
});

test("llegada: recibidas obligatorias, dañadas no más que recibidas", () => {
  const items = [{ id: "a", name: "Cinturón" }, { id: "b", name: "Autogrip" }];
  assert.deepEqual(cleanArrival(items, { a: { received: "1,000", damaged: "3", note: " caja rota " }, b: { received: "0" } }), {
    ok: true, rows: [{ id: "a", received_qty: 1000, damaged_qty: 3, received_note: "caja rota" }, { id: "b", received_qty: 0, damaged_qty: 0, received_note: null }],
  });
  assert.deepEqual(cleanArrival(items, { a: { received: "" }, b: { received: "1" } }), { ok: false, msg: "Escribe cuántas llegaron de “Cinturón” (0 si no llegó ninguna)." });
  assert.deepEqual(cleanArrival(items, { a: { received: "2", damaged: "3" }, b: { received: "1" } }), { ok: false, msg: "Cinturón: no pueden ser más dañadas que recibidas." });
});

test("cuadro: en camino, preparando y llegados en 30 días por ruta", () => {
  const ts = [
    transfer({ id: "1", items: [item({ dest_id: "miranova_sps", qty: 100 }), item({ dest_id: "mireva_tgu", qty: 40 })], eta: "2026-11-20" }),
    transfer({ id: "2", status: "preparing", items: [item({ dest_id: "miranova_sps", qty: 5 })] }),
    transfer({
      id: "3", status: "arrived", items: [item({ dest_id: "miranova_sps", qty: 50, received_qty: 48, damaged_qty: 1 })],
      arrivals: [{ transfer_id: "3", dest_id: "miranova_sps", arrived_at: "2026-11-05", note: null, received_by: null }],
    }),
    transfer({ id: "4", status: "cancelled", items: [item({ dest_id: "miranova_sps", qty: 999 })] }),
    transfer({ id: "5", eta: "2026-11-01", items: [item({ dest_id: "miranova_sps", qty: 7 })] }),
  ];
  const sps = routeSummary(ts, "2026-11-13").find((r) => r.dest_id === "miranova_sps")!;
  assert.deepEqual(sps.transit, { transfers: 2, units: 107, next_eta: "2026-11-01", late: 1 });
  assert.deepEqual(sps.preparing, { transfers: 1, units: 5 });
  assert.deepEqual(sps.arrived, { transfers: 1, sent: 50, received: 48, damaged: 1, shortage: 2 });
  // la llegada de hace más de 30 días ya no cuenta
  assert.equal(routeSummary(ts, "2026-12-20").find((r) => r.dest_id === "miranova_sps")!.arrived.transfers, 0);
});

const req = (over: Partial<StoreRequest>): StoreRequest => ({
  id: "r1", store_name: "ZONAHN", owner_name: null, countries: ["HN", "SV", "GT"], product: "Cinturón sin hebilla", quantity: 800,
  items: [{ product: "Cinturón sin hebilla", quantity: 800, country_quantities: { HN: 250, SV: 250, GT: 300 } }],
  notes: null, requested_at: "2026-11-07", arrival_at: null, origin_country: null, status: "pending", created_by: null, created_at: "2026-11-07T10:00:00Z",
  updated_at: "2026-11-07T10:00:00Z", ...over,
});
const lab = (over: Partial<LabPurchase>): LabPurchase => ({
  id: "l1", product: "Crema NIDA", lab_name: "Maya", status: "arrived", requested_at: "2026-11-01", shipped_at: null, arrived_at: null, boxes: null,
  qty_requested: 1000, qty_courtesy: 0, distribution: { miranova_gt: 400, miranova_hn: 300, miranova_sv: 200, dropi_gt: 100 },
  unit_price_gtq: null, fx_gtq_per_usd: null, notes: null, created_by: null, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", ...over,
});

test("por enviar: repartos a otros países menos lo enviado; Guatemala no cuenta", () => {
  const sent = new Map([[requestSource("r1", "cinturon sin hebilla", "HN"), 100], [labSource("l1", "miranova_hn"), 300]]);
  const rows = pendingToSend({ requests: [req({})], labs: [lab({})], points: POINTS, sent, settled: new Set([labSource("l1", "miranova_sv")]) });
  assert.deepEqual(rows.map((r) => [r.country, r.product, r.allocated, r.sent, r.pending, r.kind, r.dest_id]), [
    ["HN", "Cinturón sin hebilla", 250, 100, 150, "import", null],
    ["SV", "Cinturón sin hebilla", 250, 0, 250, "import", null],
  ]);
  // solicitudes cerradas no cuentan; una de un solo país va completa a ese país
  assert.equal(pendingToSend({ requests: [req({ status: "done" })], labs: [], points: POINTS, sent: new Map(), settled: new Set() }).length, 0);
  const single = pendingToSend({
    requests: [req({ countries: ["SV"], items: [{ product: "Autogrip", quantity: 300 }] })], labs: [], points: POINTS, sent: new Map(), settled: new Set(),
  });
  assert.deepEqual(single.map((r) => [r.country, r.pending, r.source]), [["SV", 300, "req:r1:autogrip:SV"]]);
  // lo de Laboratorios va a la bodega de su cuenta
  const labs = pendingToSend({ requests: [], labs: [lab({})], points: POINTS, sent: new Map(), settled: new Set() });
  assert.deepEqual(labs.map((r) => [r.country, r.dest_id, r.pending]), [["HN", "miranova_sps", 300], ["SV", "alex_sv", 200]]);
  // cada fila dice de qué laboratorio y para qué cuenta (no se ven repetidas)
  assert.deepEqual(labs.map((r) => r.from), ["Laboratorio Maya · para Miranova HN", "Laboratorio Maya · para Miranova SV"]);
  assert.equal(labName("Laboratorios Maya"), "Laboratorios Maya");
  assert.equal(labName(null), "Laboratorio");
});

test("fechas legibles", () => {
  assert.equal(dayLabel("2026-11-12"), "12 nov 2026");
  assert.equal(dayLabel(null), "—");
});

test("enviado por clave: sin traslados cancelados", () => {
  const s = sentBySource([
    { status: "transit", items: [item({ source: "x", qty: 5 }), item({ source: "x", qty: 2 }), item({ source: null, qty: 9 })] },
    { status: "cancelled", items: [item({ source: "x", qty: 100 })] },
  ]);
  assert.deepEqual([...s], [["x", 7]]);
});

test("formularios: datos del traslado, producto y bodega", () => {
  assert.deepEqual(cleanHeader({ origin_id: "boxful_gt", dest_country: "hn", carrier: " Boxful ", shipped_at: "2026-11-10", eta: "2026-11-14" }, POINTS), {
    ok: true, row: { origin_id: "boxful_gt", dest_country: "HN", carrier: "Boxful", reference: null, shipped_at: "2026-11-10", eta: "2026-11-14", notes: null },
  });
  assert.equal((cleanHeader({ origin_id: "mireva_tgu", dest_country: "HN" }, POINTS) as { msg: string }).msg, "Elige de dónde sale.");
  assert.equal((cleanHeader({ origin_id: "boxful_gt", dest_country: "HN", shipped_at: "2026-11-10", eta: "2026-11-01" }, POINTS) as { msg: string }).msg, "La llegada estimada no puede ser antes de la salida.");
  const ctx = { points: POINTS, origin_id: "boxful_gt", country: "HN" };
  assert.deepEqual(cleanLine({ dest_id: "mireva_tgu", kind: "maquila", name: " Crema ", qty: "1,200" }, ctx), { ok: true, row: { dest_id: "mireva_tgu", kind: "maquila", name: "Crema", sku: null, qty: 1200, variant: null } });
  assert.equal((cleanLine({ dest_id: "alex_sv", name: "Crema", qty: "1" }, ctx) as { msg: string }).msg, "Elige a qué bodega va “Crema”.");
  assert.equal((cleanLine({ dest_id: "mireva_tgu", name: "Crema", qty: "0" }, ctx) as { msg: string }).msg, "La cantidad de “Crema” debe ser un número entero mayor que cero.");
  assert.deepEqual(cleanPoint({ name: " Bodega Norte ", country: "hn", goods: "import", is_destination: true, accounts: ["mireva_hn", "otra", "mireva_hn"] }), {
    ok: true, row: { name: "Bodega Norte", country: "HN", city: null, goods: "import", is_origin: false, is_destination: true, accounts: ["mireva_hn"], active: true },
  });
  assert.equal(pointCode("Bodega Norte", "HN", ["bodega_norte_hn"]), "bodega_norte_hn_2");
});

test("variantes de Drop: cuadrícula color × talla en orden de tallas", () => {
  const raw = {
    variants: [["Negro", "XL"], ["Beige", "XXL"], ["Beige", "L"], ["Negro", "M"], ["Beige", "M"], ["Negro", "XXL"], ["Negro", "L"], ["Beige", "XL"], ["Rojo", "S"]].map(([c, t], i) => ({
      id: `v${i}`, sku: `${c}-${t}`, name: `${c} / ${t}`, active: true, deleted: c === "Rojo", attributes: [{ name: "Color", value: c }, { name: "Talla", value: t }],
    })),
  };
  const vs = productVariants(raw);
  assert.equal(vs.length, 8); // la borrada no cuenta
  assert.deepEqual(vs[0], { id: "v0", name: "Negro / XL", sku: "Negro-XL", attrs: [{ name: "Color", value: "Negro" }, { name: "Talla", value: "XL" }] });
  const g = variantGrid(vs)!;
  assert.equal(g.rowLabel, "Color");
  assert.equal(g.colLabel, "Talla");
  assert.deepEqual(g.rows, ["Beige", "Negro"]);
  assert.deepEqual(g.cols, ["M", "L", "XL", "XXL"]);
  assert.equal(g.at("Negro", "M")?.id, "v3");
  assert.equal(g.at("Rojo", "S"), null);
  // talla primero: igual van en columnas
  const flipped = vs.map((v) => ({ ...v, attrs: [v.attrs[1], v.attrs[0]] }));
  assert.deepEqual(variantGrid(flipped)!.cols, ["M", "L", "XL", "XXL"]);
  // un solo atributo o mezclados: lista
  assert.equal(variantGrid([{ id: "a", name: "500 ml", sku: null, attrs: [{ name: "Tamaño", value: "500 ml" }] }, { id: "b", name: "1 L", sku: null, attrs: [{ name: "Tamaño", value: "1 L" }] }]), null);
  assert.deepEqual(productVariants(null), []);
  assert.deepEqual(["10", "8", "XL", "S", "Única"].sort(compareSize), ["S", "XL", "8", "10", "Única"]);
});

test("línea con variante", () => {
  const c = cleanLine({ dest_id: "mireva_tgu", kind: "import", name: "Brasier", qty: "50", variant: " Negro /  M " }, { points: POINTS, origin_id: "boxful_gt", country: "HN" });
  assert.ok(c.ok && c.row.variant === "Negro / M");
  const bad = cleanLine({ dest_id: "mireva_tgu", kind: "import", name: "Brasier", qty: "0", variant: "Negro / M" }, { points: POINTS, origin_id: "boxful_gt", country: "HN" });
  assert.ok(!bad.ok && bad.msg.includes("“Brasier (Negro / M)”"));
  assert.equal(lineLabel({ name: "Brasier", variant: "Negro / M" }), "Brasier · Negro / M");
  assert.equal(lineLabel({ name: "Brasier", variant: null }), "Brasier");
});
