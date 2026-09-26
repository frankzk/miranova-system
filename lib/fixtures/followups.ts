// Simulación local de store_followups (seguimiento comercial): tabla en memoria con dos registros de ejemplo.
import type { FixtureModule, Row } from "./types";

const DAY = 86_400_000;
const ago = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tegucigalpa" }).format(new Date(Date.now() - n * DAY));
const HN = "11111111-1111-4111-8111-111111111111";

const store_followups: Row[] = [
  {
    id: "f0000000-0000-4000-8000-000000000001", account_id: HN, store_id: "name:ZONAHN", store_name: "ZONAHN", owner: "Andrea",
    contacted_at: ago(20), recommendation: "Probar bundle 2+1 en el producto principal", action_taken: "Llamada con el dueño; aceptó probarlo",
    status: "hecho", next_followup: ago(6), created_at: new Date(Date.now() - 20 * DAY).toISOString(), updated_at: new Date(Date.now() - 6 * DAY).toISOString(),
  },
  {
    id: "f0000000-0000-4000-8000-000000000002", account_id: HN, store_id: "name:ZONAHN", store_name: "ZONAHN", owner: "Andrea",
    contacted_at: ago(3), recommendation: "Subir precio de envío incluido a L 699", action_taken: null,
    status: "en_curso", next_followup: ago(-4), created_at: new Date(Date.now() - 3 * DAY).toISOString(), updated_at: new Date(Date.now() - 3 * DAY).toISOString(),
  },
];

export const fixtures: FixtureModule = { tables: { store_followups } };
