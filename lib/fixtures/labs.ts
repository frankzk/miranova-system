// Simulación local de lab_purchases (Compras › Laboratorios): tabla en memoria con ejemplos.
import type { FixtureModule, Row } from "./types";

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const day = (days: number) => new Date(Date.now() - days * DAY - 6 * 3_600_000).toISOString().slice(0, 10);
const OWNER = "a0000000-0000-4000-8000-000000000001";

const row = (n: number, r: Row): Row => ({
  id: `f0000000-0000-4000-8000-00000000000${n}`, lab_name: null, shipped_at: null, arrived_at: null, boxes: null, qty_courtesy: 0,
  distribution: {}, unit_price_gtq: null, fx_gtq_per_usd: 7.65, notes: null, created_by: OWNER,
  created_at: at(r.days), updated_at: at(r.days), requested_at: day(r.days), ...r,
});

const lab_purchases: Row[] = [
  row(1, {
    days: 12, product: "Drenaje linfático Maya Verra", lab_name: "Laboratorios Maya", status: "transit", shipped_at: day(3), boxes: 21,
    qty_requested: 1000, qty_courtesy: 50, unit_price_gtq: 12.5,
    distribution: { miranova_gt: 400, miranova_hn: 300, mireva_hn: 100, miranova_sv: 100, dropi_gt: 100 },
  }),
  row(2, { days: 4, product: "Colágeno hidrolizado 500 g", status: "requested", qty_requested: 600, unit_price_gtq: 38, distribution: { miranova_gt: 300 } }),
  row(3, {
    days: 30, product: "Gotas de magnesio", lab_name: "Laboratorios Maya", status: "arrived", shipped_at: day(22), arrived_at: day(20), boxes: 8,
    qty_requested: 400, qty_courtesy: 20, unit_price_gtq: 9.75,
    distribution: { miranova_gt: 120, miranova_hn: 100, miranova_cr: 80, mireva_cr: 60, dropi_cr: 60 },
  }),
];

export const fixtures: FixtureModule = { tables: { lab_purchases } };
