import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanLabPurchase, labTotals, matchesLab, parseDistribution } from "./lab-purchases.ts";

const TODAY = "2026-10-23";
const base = { product: "Drenaje Maya Verra", qty_requested: "1,000", qty_courtesy: "50" };

test("compra válida: cantidades, reparto, fechas y montos", () => {
  const r = cleanLabPurchase(
    {
      ...base, lab_name: " Lab  Maya ", status: "transit", requested_at: "2026-10-01", shipped_at: "2026-10-10", boxes: "21",
      distribution: { miranova_gt: "500", miranova_hn: "300", mireva_cr: "", dropi_gt: "250" }, unit_price_gtq: "Q12.50", fx_gtq_per_usd: "7.65",
    },
    TODAY, true,
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.row.distribution, { miranova_gt: 500, miranova_hn: 300, dropi_gt: 250 });
  assert.deepEqual([r.row.lab_name, r.row.boxes, r.row.qty_requested, r.row.qty_courtesy, r.row.unit_price_gtq], ["Lab Maya", 21, 1000, 50, 12.5]);
  // la cortesía no se cobra: 12.50 × 1,000 = Q12,500 → USD 1,633.99 a 7.65
  assert.deepEqual(labTotals(r.row), { total: 1050, distributed: 1050, pending: 0, amount_gtq: 12500, amount_usd: 1633.99 });
});

test("sin permiso de Dinero no se leen precio ni tipo de cambio", () => {
  const r = cleanLabPurchase({ ...base, unit_price_gtq: "12", fx_gtq_per_usd: "7.6" }, TODAY, false);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && [r.row.unit_price_gtq, r.row.fx_gtq_per_usd], [null, null]);
  assert.deepEqual(r.ok && labTotals(r.row).amount_gtq, null);
});

test("llegó a bodega sin fecha: se toma hoy; solicitud vacía: hoy", () => {
  const r = cleanLabPurchase({ ...base, status: "arrived" }, TODAY, true);
  assert.deepEqual(r.ok && [r.row.requested_at, r.row.arrived_at], [TODAY, TODAY]);
});

test("errores claros", () => {
  const msg = (i: Record<string, unknown>) => {
    const r = cleanLabPurchase({ ...base, ...i }, TODAY, true);
    return r.ok ? "ok" : r.msg;
  };
  assert.equal(msg({ product: " " }), "Escribe el nombre del producto.");
  assert.match(msg({ qty_requested: "0" }), /mayor que cero/);
  assert.match(msg({ qty_courtesy: "-3" }), /cortesía/);
  assert.match(msg({ distribution: { miranova_sv: "2.5" } }), /Miranova SV/);
  assert.equal(msg({ distribution: { miranova_gt: "1000", miranova_hn: "51" } }), "Se reparten 1,051 unidades y solo llegan 1,050 (solicitada + cortesía).");
  assert.equal(msg({ requested_at: "2026-10-24" }), "La fecha de solicitud no puede ser futura.");
  assert.equal(msg({ requested_at: "2026-10-10", shipped_at: "2026-10-09" }), "La fecha de traslado no puede ser anterior a la solicitud.");
  assert.equal(msg({ requested_at: "2026-10-01", shipped_at: "2026-10-10", arrived_at: "2026-10-05" }), "La fecha de llegada a Drop no puede ser anterior al traslado.");
  assert.match(msg({ fx_gtq_per_usd: "0" }), /tipo de cambio/);
  assert.match(msg({ unit_price_gtq: "doce" }), /precio/);
  assert.equal(msg({ status: "perdido" }), "Estado no válido.");
});

test("lectura segura de la distribución y búsqueda", () => {
  assert.deepEqual(parseDistribution({ miranova_gt: 10, otra: 5, mireva_hn: -2, dropi_cr: "7" }), { miranova_gt: 10, dropi_cr: 7 });
  assert.deepEqual(parseDistribution(null), {});
  assert.ok(matchesLab({ product: "Drenaje Linfático", lab_name: "Maya Verra", notes: null }, "maya"));
  assert.ok(matchesLab({ product: "Drenaje Linfático", lab_name: null, notes: null }, "linfatico"));
  assert.ok(!matchesLab({ product: "Colágeno", lab_name: null, notes: null }, "drenaje"));
});
