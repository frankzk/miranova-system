import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays, daysBetween, impact, isDay, isFollowupStatus, metricOf, niceMax, rangeSummary, vsAverage, windowStats, type StoreDay,
} from "./store-metrics.ts";

/** Serie de `n` días que termina en `end`, con los pedidos dados (ticket fijo por día). */
function series(end: string, orders: number[], ticket: number | number[] = 100): StoreDay[] {
  return orders.map((o, i) => {
    const t = Array.isArray(ticket) ? ticket[i] : ticket;
    return { day: addDays(end, i - orders.length + 1), orders: o, sales: o * t, units: o };
  });
}

test("fechas locales", () => {
  assert.equal(addDays("2026-09-26", -7), "2026-09-19");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(daysBetween("2026-09-19", "2026-09-26"), 7);
  assert.ok(isDay("2026-09-26"));
  assert.ok(!isDay("2026-02-30"));
  assert.ok(!isDay("26/09/2026"));
});

test("ventana: pedidos por día y ticket ponderado, con días en cero", () => {
  const d = series("2026-09-10", [5, 0, 0, 10, 5], [100, 0, 0, 200, 100]);
  const w = windowStats(d, "2026-09-06", "2026-09-10");
  assert.equal(w.orders, 20);
  assert.equal(w.days, 5);
  assert.equal(w.perDay, 4);
  assert.equal(w.ticket, (500 + 2000 + 500) / 20);
  assert.equal(windowStats(d, "2026-09-07", "2026-09-08").ticket, null);
});

test("impacto: 7 días antes vs. 7 días desde el contacto", () => {
  // 7 días a 8 pedidos (ticket 190) y luego 7 días a 14 (ticket 270)
  const d = series("2026-09-20", [...Array(7).fill(8), ...Array(7).fill(14)], [...Array(7).fill(190), ...Array(7).fill(270)]);
  const r = impact(d, "2026-09-14", "2026-09-21");
  assert.equal(r.state, "ready");
  if (r.state !== "ready") return;
  assert.equal(r.before.perDay, 8);
  assert.equal(r.after.perDay, 14);
  assert.equal(r.before.ticket, 190);
  assert.equal(r.after.ticket, 270);
  assert.equal(r.ordersChange, 0.75);
});

test("impacto: midiendo mientras no pasan 7 días; sin datos si la serie no alcanza", () => {
  const d = series("2026-09-26", Array(90).fill(3));
  assert.deepEqual(impact(d, "2026-09-26", "2026-09-26"), { state: "measuring", daysLeft: 7 });
  assert.deepEqual(impact(d, "2026-09-22", "2026-09-26"), { state: "measuring", daysLeft: 3 });
  assert.equal(impact(d, "2026-09-19", "2026-09-26").state, "ready");
  assert.deepEqual(impact(d, "2026-06-01", "2026-09-26"), { state: "no_data" });
  // fecha de contacto futura: sigue midiendo (faltan 7)
  assert.deepEqual(impact(d, "2026-09-30", "2026-09-26"), { state: "measuring", daysLeft: 7 });
});

test("comparación con el promedio de las tiendas", () => {
  assert.deepEqual(vsAverage(8, 14), { tone: "down", text: "43% abajo" });
  assert.deepEqual(vsAverage(270, 190), { tone: "up", text: "42% arriba" });
  assert.deepEqual(vsAverage(1.3, 1.32), { tone: "flat", text: "en el promedio" });
  assert.deepEqual(vsAverage(73.6, 5.65), { tone: "up", text: "13.0× el promedio" });
  assert.equal(vsAverage(null, 5), null);
  assert.equal(vsAverage(5, 0), null);
});

test("gráfica: ticket del día sin pedidos es 0 y el del rango es ponderado", () => {
  const d = series("2026-09-03", [2, 0, 1], [100, 0, 400]);
  assert.equal(metricOf(d[1], "ticket"), 0);
  assert.equal(metricOf(d[2], "ticket"), 400);
  assert.equal(rangeSummary(d, "ticket").total, 200);
  assert.deepEqual(rangeSummary(d, "orders"), { total: 3, perDay: 1 });
  assert.equal(niceMax(3), 5);
  assert.equal(niceMax(108), 200);
});

test("estado del seguimiento válido", () => {
  assert.ok(isFollowupStatus("en_curso"));
  assert.ok(!isFollowupStatus("toString"));
});
