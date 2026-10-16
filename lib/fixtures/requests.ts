// Simulación local de store_requests (solicitudes de tiendas): tabla en memoria con ejemplos.
import type { FixtureModule, Row } from "./types";

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const OWNER = "a0000000-0000-4000-8000-000000000001";

const row = (n: number, r: Row): Row => ({
  id: `e0000000-0000-4000-8000-00000000000${n}`, owner_name: null, notes: null, status: "pending", created_by: OWNER,
  created_at: at(r.days), updated_at: at(r.days), ...r,
});

const store_requests: Row[] = [
  row(1, { days: 1, store_name: "ZONAHN", owner_name: "Andrea Paz", countries: ["HN"], product: "Drenaje Linfático en Gotas", quantity: 500, notes: "Lo quiere antes de fin de mes" }),
  row(2, { days: 3, store_name: "Vital Market", owner_name: "José Pérez", countries: ["HN", "GT", "SV", "CR"], product: "Colágeno Hidrolizado", quantity: 1200, status: "in_progress" }),
  row(3, { days: 5, store_name: "Tienda Bella", countries: ["GT"], product: "drenaje linfatico en gotas", quantity: 300 }),
  row(4, { days: 20, store_name: "ZONAHN", owner_name: "Andrea Paz", countries: ["HN"], product: "Mini ventilador portátil", quantity: 200, status: "done" }),
];

export const fixtures: FixtureModule = { tables: { store_requests } };
