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
// Liquidaciones de Drop (sintéticas) para ver los 3 pasos: una por cada situación.
const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
const isoDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tegucigalpa" }).format(d);
const HN = "11111111-1111-4111-8111-111111111111";
const GT = "22222222-2222-4222-8222-222222222222";
const settlement = (n: number, row: Row): Row => {
  const at = ago(row.days ?? 3);
  delete row.days;
  return {
    id: `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    company: "miranova", source: "drop", account_id: HN, external_id: `set${n}`, confirmation: "",
    operation: "miranova", country: "HN", requested_at: at.toISOString(), requested_on: isoDay(at), status: "paid",
    status_label: "Liquidada", failure_reason: "", currency: "HNL", usd_rate: 0.0388581101, usd_amount_cents: null,
    bank: "Choice Financial Group", bank_account: "••0000", evidence: [], raw: {}, boxful_id: null, linked_by: null,
    linked_at: null, reviewed_by: null, reviewed_at: null, review_note: null, synced_at: now, created_at: now, ...row,
  };
};
const pdf = (n: number, days: number, row: Row): Row =>
  entry(n, { source: "boxful", occurred_on: isoDay(ago(days)), counterparty: "Boxful", bank_account: "0000", document_path: "demo.pdf", document_name: `liquidacion-${n}.pdf`, ...row });
const mercury = (n: number, days: number, row: Row): Row =>
  entry(n, { source: "mercury", occurred_on: isoDay(ago(days)), counterparty: "BOXFUL TECHNOLOGIES", bank_account: "Checking ••0000", ...row });

const closedPdf = pdf(15, 52, { reference: "4O57O4YJ HN", amount_cents: 799120, origin_operation: "miranova", origin_country: "HN" });
const closedMercury = mercury(16, 50, { reference: "MERC-799120", amount_cents: 799120 });

export const fixtures: FixtureModule = {
  tables: {
    bank_entries: [
      entry(1, {
        source: "boxful",
        amount_cents: 125000,
        original_currency: "GTQ",
        original_amount_cents: 962500,
        origin_operation: "miranova",
        origin_country: "GT",
      }),
      entry(2, { source: "boxful", amount_cents: 300000, origin_operation: "mireva" }),
      entry(3, { source: "mercury", amount_cents: 125000 }),
      entry(4, { source: "mercury", amount_cents: 298000 }),
      entry(5, { source: "mercury", amount_cents: 125000 }),
      entry(6, { company: "mireva", source: "boxful", amount_cents: 88000 }),
      entry(7, { company: "mireva", source: "mercury", amount_cents: 88000 }),
      // para las liquidaciones
      pdf(11, 9, { reference: "Miranova HN", amount_cents: 1408549, original_currency: "USD", origin_operation: "miranova", origin_country: "HN" }),
      mercury(12, 8, { reference: "MERC-1408549", amount_cents: 1408549 }),
      pdf(13, 4, { reference: "2347001", amount_cents: 1009240, origin_operation: "miranova", origin_country: "HN" }),
      pdf(14, 2, { reference: "Miranova SV", amount_cents: 500000, origin_operation: "miranova", origin_country: "SV" }),
      closedPdf,
      closedMercury,
      pdf(18, 10, { reference: "2352659", amount_cents: 345293, origin_operation: "mireva", origin_country: "HN" }),
      pdf(17, 9, { reference: "Miranova SV - Pago Bodega", amount_cents: 30000, notes: "Arriendo bodega El Salvador", origin_operation: "miranova", origin_country: "SV" }),
    ],
    settlements: [
      settlement(1, { reference: "ILGA5JTC", confirmation: "2355766", amount_cents: 36300000, days: 9 }),
      settlement(2, { reference: "B4TTB8JR", confirmation: "2347001", amount_cents: 26000000, days: 5 }),
      settlement(3, { reference: "QB65AIKE", confirmation: "", amount_cents: 17400000, days: 24 }),
      settlement(4, { reference: "K7Q2LM0P", country: "SV", currency: "USD", usd_rate: 1, amount_cents: 500000, days: 3, boxful_id: "b0000000-0000-4000-8000-000000000014", linked_by: owner, linked_at: now }),
      settlement(5, { reference: "2IPDBP91", amount_cents: 22291100, status: "rejected", status_label: "Rechazada", failure_reason: "Cuenta de destino no válida", days: 95 }),
      settlement(6, { reference: "4O57O4YJ", confirmation: "2290011", amount_cents: 20600000, days: 52, boxful_id: "b0000000-0000-4000-8000-000000000015", linked_by: owner, linked_at: now }),
      settlement(8, { source: "boxful", account_id: null, operation: "mireva", reference: "2352476-2353166-2352477-2352659-42401306", usd_rate: null, amount_cents: 9391879, shipments: 208, days: 8 }),
      settlement(7, { reference: "WKHYOORV", account_id: GT, country: "GT", currency: "GTQ", usd_rate: 0.130664957, amount_cents: 4020000, status: "pending", status_label: "Pendiente", days: 1 }),
    ],
    settlement_exempt_entries: [],
    bank_matches: [
      {
        id: "d0000000-0000-4000-8000-000000000001", company: "miranova",
        boxful_id: "b0000000-0000-4000-8000-000000000015", mercury_id: "b0000000-0000-4000-8000-000000000016",
        boxful_version: 1, mercury_version: 1, fee_cents: 0, fee_note: "", created_by: owner, created_at: now,
        reversed_at: null, reversed_by: null, reversal_reason: null, boxful_snapshot: closedPdf, mercury_snapshot: closedMercury,
      },
    ],
    bank_audit: [],
  },
};
