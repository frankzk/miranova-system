// Simulación local de store_requests (solicitudes de tiendas): tabla en memoria con ejemplos.
import type { FixtureModule, Row } from "./types";

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const OWNER = "a0000000-0000-4000-8000-000000000001";

const day = (days: number) => new Date(Date.now() - days * DAY - 6 * 3_600_000).toISOString().slice(0, 10);
const row = (n: number, r: Row): Row => ({
  id: `e0000000-0000-4000-8000-00000000000${n}`, owner_name: null, notes: null, status: "pending", created_by: OWNER,
  created_at: at(r.days), updated_at: at(r.days), requested_at: day(r.days), arrival_at: null, origin_country: null, ...r,
});

const store_requests: Row[] = [
  row(1, { days: 1, store_name: "ZONAHN", owner_name: "Andrea Paz", countries: ["HN"], product: "Drenaje Linfático en Gotas", quantity: 500, notes: "Lo quiere antes de fin de mes", origin_country: "China", arrival_at: day(-20) }),
  row(2, { days: 3, store_name: "Vital Market", owner_name: "José Pérez", countries: ["HN", "GT", "SV", "CR"], product: "Colágeno Hidrolizado", quantity: 1200, status: "in_progress", origin_country: "Estados Unidos", arrival_at: day(1) }),
  row(3, { days: 5, store_name: "Tienda Bella", countries: ["GT"], product: "drenaje linfatico en gotas", quantity: 300 }),
  row(4, { days: 20, store_name: "ZONAHN", owner_name: "Andrea Paz", countries: ["HN"], product: "Mini ventilador portátil", quantity: 200, status: "done" }),
];

// líneas de producto: ZONAHN pidió dos productos en la misma solicitud; las demás, uno
const store_request_items: Row[] = [
  { id: "e1000000-0000-4000-8000-000000000001", request_id: store_requests[0].id, position: 0, product: "Drenaje Linfático en Gotas", quantity: 500, created_at: at(1) },
  { id: "e1000000-0000-4000-8000-000000000002", request_id: store_requests[0].id, position: 1, product: "SommaSleep Spray Oral Antirronquidos", quantity: 400, created_at: at(1) },
];
store_requests[0].quantity = 900;

export const fixtures: FixtureModule = { tables: { store_requests, store_request_items } };
