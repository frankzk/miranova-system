// Simulación local de los avisos de "Problemas en gestión" y de las llaves de asistentes (MCP).
import type { FixtureModule, Row } from "./types";

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() - days * DAY).toISOString();

// un aviso ya enviado hace 12 días: desde ahí (menos 3 días) cuentan los pedidos nuevos
const problem_notice_batches: Row[] = [
  {
    id: "0000000000000000demo", group_key: "c:c0000000-0000-4000-8000-000000000001", contact_id: "c0000000-0000-4000-8000-000000000001",
    title: "ZONAHN", order_ids: [], message: "¡Hola, Luis! …", created_at: at(12), sent_at: at(12), sent_via: "panel", sent_by: "Frank Dueño",
  },
];

export const fixtures: FixtureModule = {
  tables: { assistant_keys: [], problem_notice_batches, problem_notices: [] },
};
