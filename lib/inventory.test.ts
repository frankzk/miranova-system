import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays, dailySpread, daysBetween, demand, inventoryAlerts, leadTime, niceUp, NO_SUPPLY, perDay7, reorderPlan, returnRate,
  trackOrders, urgency, type InventoryRow, type RestockOrder, type Supply,
} from "./inventory.ts";

const TODAY = "2026-10-04";
const row = (p: Partial<InventoryRow>): InventoryRow => ({
  account_id: "a", account_name: "Drop Honduras", external_id: "p", code: null, name: "Producto", status: "Activo", image_url: null,
  stock: 0, variants_count: 0, out14: 0, ret14: 0, out30: 0, ret30: 0, last_out_at: null, first_at: null, last_restock_at: null,
  restocks: [], pending_orders: 0, daily: [], ...p,
});
// 10 u./día parejo (hoy va a medias: 3)
const steady = (p: Partial<InventoryRow> = {}) => row({ out14: 140, out30: 300, daily: [...Array(29).fill(10), 3], ...p });
const order = (p: Partial<RestockOrder>): RestockOrder => ({
  id: "o1", account_id: "a", product_external_id: "p", units: 100, ordered_at: "2026-10-01T12:00:00+00:00", eta: null,
  note: null, cancelled_at: null, ...p,
});
const supply = (orders: RestockOrder[] = [], leads: [string, number][] = []): Supply => ({ orders, leads: new Map(leads) });

test("fechas: sumar días y contar días entre fechas", () => {
  assert.equal(addDays("2026-10-30", 3), "2026-11-02");
  assert.equal(daysBetween("2026-10-04", "2026-10-09"), 5);
});

test("venta para planear: la más alta entre 7 y 14 días, sin contar hoy", () => {
  assert.equal(perDay7(steady()), 10);
  // venía a 5/día en 14 días pero la última semana a 10/día → planea con 10
  const up = row({ out14: 70, daily: [...Array(22).fill(0), ...Array(7).fill(10), 0] });
  assert.equal(demand(up), 10);
  assert.equal(demand(row({ out14: 140, ret14: 28, daily: [] })), 8);
});

test("variación diaria y redondeo fácil de pedir", () => {
  assert.equal(dailySpread(steady()), 0);
  const zigzag = row({ daily: [...Array(15)].map((_, i) => (i % 2 ? 20 : 0)) });
  assert.equal(Math.round(dailySpread(zigzag) * 100) / 100, 10.38);
  assert.deepEqual([niceUp(-3), niceUp(7.2), niceUp(21), niceUp(314)], [0, 8, 25, 320]);
});

test("pedidos: cada entrada de Drop cierra el pedido más antiguo; sin entrada y con fecha vencida, atrasado", () => {
  const orders = [
    order({ id: "b", ordered_at: "2026-09-20T12:00:00+00:00" }),
    order({ id: "a", ordered_at: "2026-09-01T12:00:00+00:00" }),
    order({ id: "c", ordered_at: "2026-09-28T12:00:00+00:00", eta: "2026-10-01" }),
    order({ id: "d", ordered_at: "2026-09-29T12:00:00+00:00", eta: "2026-10-10" }),
    order({ id: "x", ordered_at: "2026-09-30T12:00:00+00:00", cancelled_at: "2026-09-30T13:00:00+00:00" }),
  ];
  const restocks = [
    { at: "2026-09-25T12:00:00+00:00", units: 200, reason: "STOCK_REQUEST" },
    { at: "2026-09-10T12:00:00+00:00", units: 100, reason: "STOCK_REQUEST" },
  ];
  const t = trackOrders(orders, restocks, TODAY);
  assert.deepEqual(t.map((o) => [o.id, o.status]), [["a", "arrived"], ["b", "arrived"], ["c", "late"], ["d", "open"], ["x", "cancelled"]]);
  assert.equal(t[0].arrived_at, "2026-09-10T12:00:00+00:00");
  assert.equal(t[1].arrived_units, 200);
  // tardaron 9 y 5 días → se mide 7
  assert.deepEqual(leadTime("a:p", t, NO_SUPPLY), { days: 7, source: "measured", samples: 2 });
  assert.deepEqual(leadTime("a:p", t, supply([], [["a:p", 30]])), { days: 30, source: "manual", samples: 2 });
  assert.deepEqual(leadTime("a:p", [], NO_SUPPLY), { days: 8, source: "default", samples: 0 });
});

test("punto de pedido: 10 u./día, 8 días de reposición y colchón", () => {
  // colchón = 1.65 × (mínimo 5 u./día de variación) × √8 = 23.3 → 24; punto = 80 + 24 = 104
  const ok = reorderPlan(steady({ stock: 300 }), NO_SUPPLY, TODAY);
  assert.equal(ok.demand, 10);
  assert.equal(ok.safety, 24);
  assert.equal(ok.reorderPoint, 104);
  assert.equal(ok.level, "ok");
  assert.equal(ok.orderBy, "2026-10-23"); // (300 − 104) / 10 = 19.6 días
  assert.equal(ok.stockoutOn, "2026-11-03");
  assert.equal(ok.needsOrder, false);
  assert.equal(ok.qty, 300); // pedir a tiempo = 30 días de venta

  const soon = reorderPlan(steady({ stock: 150 }), NO_SUPPLY, TODAY);
  assert.equal(soon.level, "soon");
  assert.equal(soon.orderBy, "2026-10-08");

  const now = reorderPlan(steady({ stock: 90 }), NO_SUPPLY, TODAY);
  assert.equal(now.level, "now");
  assert.equal(now.orderBy, TODAY);
  assert.equal(now.qty, 320); // 10 × (8 + 30) + 24 − 90 = 314 → 320
});

test("lo que viene en camino cuenta; si llega después de agotarse, se avisa el hueco", () => {
  const coming = supply([order({ units: 200, eta: "2026-10-09" })]);
  const p = reorderPlan(steady({ stock: 90 }), coming, TODAY);
  assert.equal(p.inTransit, 200);
  assert.equal(p.position, 290);
  assert.equal(p.level, "ok");
  assert.equal(p.needsOrder, false);
  assert.equal(p.gapDays, null); // se agota el 13, llega el 9

  const late = reorderPlan(steady({ stock: 30 }), coming, TODAY);
  assert.equal(late.stockoutOn, "2026-10-07");
  assert.equal(late.gapDays, 2);

  const out = reorderPlan(steady({ stock: 0 }), supply([order({ units: 300, eta: "2026-10-09" })]), TODAY);
  assert.equal(out.level, "out");
  assert.equal(out.needsOrder, false);
  assert.equal(out.gapDays, 5);
  // lo que ya llegó no cuenta como en camino, y lo que tardó pasa a ser el tiempo de reposición
  const arrived = reorderPlan(
    steady({ stock: 90, restocks: [{ at: "2026-09-30T12:00:00+00:00", units: 200, reason: "STOCK_REQUEST" }] }),
    supply([order({ units: 200, ordered_at: "2026-09-20T12:00:00+00:00", eta: "2026-09-28" })]), TODAY,
  );
  assert.equal(arrived.inTransit, 0);
  assert.equal(arrived.orders[0].status, "arrived");
  assert.deepEqual([arrived.lead, arrived.leadSource], [10, "measured"]);
  assert.equal(arrived.level, "now");
});

test("tiempo de reposición largo y venta irregular suben el punto de pedido", () => {
  const china = reorderPlan(steady({ stock: 300 }), supply([], [["a:p", 30]]), TODAY);
  assert.equal(china.reorderPoint, 300 + Math.ceil(1.65 * 5 * Math.sqrt(30)));
  assert.equal(china.level, "now");
  const irregular = reorderPlan(row({ out14: 140, stock: 300, daily: [...Array(30)].map((_, i) => (i % 2 ? 20 : 0)) }), NO_SUPPLY, TODAY);
  assert.ok(irregular.safety > 24);
});

test("sin movimiento, agotados y orden de urgencia", () => {
  assert.equal(reorderPlan(row({ stock: 80 }), NO_SUPPLY, TODAY).level, "idle");
  assert.equal(reorderPlan(row({ stock: 0 }), NO_SUPPLY, TODAY).level, "idle");
  assert.equal(reorderPlan(row({ stock: 0, pending_orders: 3 }), NO_SUPPLY, TODAY).level, "out");
  const plans = [
    reorderPlan(steady({ stock: 300 }), NO_SUPPLY, TODAY),
    reorderPlan(steady({ stock: 0 }), NO_SUPPLY, TODAY),
    reorderPlan(steady({ stock: 90 }), NO_SUPPLY, TODAY),
    reorderPlan(row({ stock: 80 }), NO_SUPPLY, TODAY),
  ];
  assert.deepEqual([...plans].sort((a, b) => urgency(a) - urgency(b)).map((p) => p.level), ["out", "now", "ok", "idle"]);
});

test("alertas: agotado, pedir hoy, pedir esta semana y devoluciones; lo que viene se menciona", () => {
  const a = steady({ external_id: "a", name: "Agotado", stock: 0, pending_orders: 4 });
  const b = steady({ external_id: "b", name: "Hoy", stock: 90 });
  const c = steady({ external_id: "c", name: "Semana", stock: 150 });
  const d = steady({ external_id: "d", name: "Holgado", stock: 500, out30: 200, ret30: 60 });
  const alerts = inventoryAlerts([d, c, b, a], NO_SUPPLY, TODAY);
  assert.deepEqual(alerts.map((x) => [x.product_name, x.kind]), [["Agotado", "stockout"], ["Hoy", "low_stock"], ["Semana", "low_stock"], ["Holgado", "returns"]]);
  assert.match(alerts[0].action, /pedir ya unas 410 u\./);
  assert.equal(alerts[2].title, "Pedir antes del 8/10");
  assert.equal(returnRate(row({ out30: 10, ret30: 5 })), null); // poca muestra

  const withOrder = inventoryAlerts([a], supply([order({ product_external_id: "a", units: 300, eta: "2026-10-09" })]), TODAY);
  assert.match(withOrder[0].detail, /vienen 300 u\. \(llegada 9\/10\)/);
  assert.match(withOrder[0].action, /ya viene/);
});
