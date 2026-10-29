import type { FixtureModule, Row } from "./types";
// Ejemplos sintéticos; nunca se importan movimientos desde una captura de pantalla.
const now = new Date().toISOString();
const day = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Lima",
}).format(new Date());
const owner = "a0000000-0000-4000-8000-000000000001";
const entry = (n: number, row: Row): Row => ({
  id: `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  company: "miranova",
  occurred_on: day,
  reference: `DEMO-${n}`,
  original_currency: "USD",
  original_amount_cents: row.amount_cents,
  counterparty: "Boxful (ejemplo)",
  bank_account: "Checking DEMO",
  notes: "Datos sintéticos de desarrollo",
  document_path: null,
  document_name: null,
  document_sha256: null,
  version: 1,
  void_reason: null,
  created_by: owner,
  updated_by: owner,
  created_at: now,
  updated_at: now,
  ...row,
});
export const fixtures: FixtureModule = {
  tables: {
    bank_entries: [
      entry(1, {
        source: "boxful",
        amount_cents: 125000,
        original_currency: "GTQ",
        original_amount_cents: 962500,
      }),
      entry(2, { source: "boxful", amount_cents: 300000 }),
      entry(3, { source: "mercury", amount_cents: 125000 }),
      entry(4, { source: "mercury", amount_cents: 298000 }),
      entry(5, { source: "mercury", amount_cents: 125000 }),
      entry(6, { company: "mireva", source: "boxful", amount_cents: 88000 }),
      entry(7, { company: "mireva", source: "mercury", amount_cents: 88000 }),
    ],
    bank_matches: [],
    bank_audit: [],
  },
};
