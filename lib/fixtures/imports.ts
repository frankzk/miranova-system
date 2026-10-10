// Importaciones de prueba: una a Honduras en tránsito con productos del catálogo, costos y un
// pago; otra a Guatemala con un producto nuevo, todavía en cotización; y una a Honduras ya
// recibida, con un producto que ya entró a Drop y otro nuevo que todavía no se enlaza.
import type { FixtureModule } from "./types";

const DAY = 86_400_000;
const iso = (d: number) => new Date(Date.now() + d * DAY).toISOString();
const date = (d: number) => iso(d).slice(0, 10);
const HN = "11111111-1111-4111-8111-111111111111";
const OWNER = "a0000000-0000-4000-8000-000000000001";
const A = "c0000000-0000-4000-8000-000000000001";
const B = "c0000000-0000-4000-8000-000000000002";
const C = "c0000000-0000-4000-8000-000000000003";

export const fixtures: FixtureModule = {
  tables: {
    imports: [
      {
        id: A, code: `IMP-${new Date().getFullYear()}-001`, supplier: "Yiwu Trading Co.", origin: "China", dest_country: "HN", status: "transit",
        ordered_at: date(-10), eta: date(2), arrived_at: null, transport: "courier", carrier: "DHL", tracking_number: "1234567890", tracking_url: null,
        weight_kg: 42, reported_at: null, reported_by: null, notes: "Pedido mixto: peladores y mini ventiladores.", created_by: OWNER,
        created_at: iso(-12), updated_at: iso(-1),
      },
      {
        id: B, code: `IMP-${new Date().getFullYear()}-002`, supplier: "Shenzhen Gadgets", origin: "China", dest_country: "GT", status: "quote",
        ordered_at: null, eta: null, arrived_at: null, transport: "courier", carrier: null, tracking_number: null, tracking_url: null,
        weight_kg: null, reported_at: null, reported_by: null, notes: null, created_by: OWNER, created_at: iso(-2), updated_at: iso(-2),
      },
      {
        id: C, code: `IMP-${new Date().getFullYear()}-003`, supplier: "Guangzhou Beauty", origin: "China", dest_country: "HN", status: "received",
        ordered_at: date(-35), eta: date(-14), arrived_at: date(-15), transport: "courier", carrier: "FedEx", tracking_number: "771234567890", tracking_url: null,
        weight_kg: 18, reported_at: iso(-17), reported_by: OWNER, notes: null, created_by: OWNER, created_at: iso(-36), updated_at: iso(-15),
      },
    ],
    import_items: [
      { id: "c1000000-0000-4000-8000-000000000001", import_id: A, account_id: HN, product_external_id: "p1", name: "Set de Pelador de Verduras Abridor", sku: "00940184", image_url: null, photo_path: null, qty: 300, unit_cost: 1.8, unit_weight_kg: 0.12, sale_price_usd: null, position: 0, created_at: iso(-12) },
      { id: "c1000000-0000-4000-8000-000000000002", import_id: A, account_id: HN, product_external_id: "p4", name: "MINI FAN", sku: "MINI.FAN", image_url: null, photo_path: null, qty: 150, unit_cost: 3.2, unit_weight_kg: 0.25, sale_price_usd: null, position: 1, created_at: iso(-12) },
      { id: "c1000000-0000-4000-8000-000000000003", import_id: B, account_id: null, product_external_id: null, name: "Lámpara LED plegable", sku: null, image_url: null, photo_path: null, qty: 200, unit_cost: 2.5, unit_weight_kg: null, sale_price_usd: 9, position: 0, created_at: iso(-2) },
      {
        id: "c1000000-0000-4000-8000-000000000004", import_id: C, account_id: HN, product_external_id: "p2", name: "PRODUCTO EXCLUSIVO DLG", sku: "10954739", image_url: null, photo_path: null,
        qty: 120, unit_cost: 2, unit_weight_kg: 0.1, sale_price_usd: null, position: 0, created_at: iso(-36),
        received_qty: 118, damaged_qty: 2, received_note: "2 cajas golpeadas", received_at: iso(-15), received_by: OWNER,
      },
      {
        id: "c1000000-0000-4000-8000-000000000005", import_id: C, account_id: null, product_external_id: null, name: "Chip ahorrador de combustible OBD2", sku: "AHORRADOR.COMBUSTIBLE", image_url: null, photo_path: null,
        qty: 100, unit_cost: 1.2, unit_weight_kg: 0.05, sale_price_usd: 8, position: 1, created_at: iso(-36),
        received_qty: null, damaged_qty: 0, received_note: null, received_at: null, received_by: null,
      },
    ],
    import_costs: [
      { id: "c2000000-0000-4000-8000-000000000001", import_id: A, kind: "shipping", label: "Flete DHL", amount: 310, allocation: "weight", item_id: null, created_at: iso(-10) },
      { id: "c2000000-0000-4000-8000-000000000002", import_id: A, kind: "import", label: "Aranceles e impuestos", amount: 185, allocation: "value", item_id: null, created_at: iso(-3) },
      { id: "c2000000-0000-4000-8000-000000000003", import_id: A, kind: "other", label: "Etiquetado", amount: 30, allocation: "units", item_id: null, created_at: iso(-3) },
      { id: "c2000000-0000-4000-8000-000000000004", import_id: C, kind: "shipping", label: "FedEx", amount: 88, allocation: "weight", item_id: null, created_at: iso(-30) },
    ],
    import_payments: [
      { id: "c3000000-0000-4000-8000-000000000001", import_id: A, paid_at: date(-12), amount: 600, method: "Transferencia", note: "Anticipo", document_id: null, created_by: OWNER, created_at: iso(-12) },
    ],
    import_documents: [],
    import_events: [
      { id: "c4000000-0000-4000-8000-000000000001", import_id: A, status: "quote", note: "Importación creada", by_user: OWNER, at: iso(-12) },
      { id: "c4000000-0000-4000-8000-000000000002", import_id: A, status: "paid", note: "Anticipo del 50 %", by_user: OWNER, at: iso(-11) },
      { id: "c4000000-0000-4000-8000-000000000003", import_id: A, status: "transit", note: "Salió de Shenzhen", by_user: OWNER, at: iso(-4) },
      { id: "c4000000-0000-4000-8000-000000000004", import_id: B, status: "quote", note: "Importación creada", by_user: OWNER, at: iso(-2) },
      { id: "c4000000-0000-4000-8000-000000000005", import_id: C, status: "quote", note: "Importación creada", by_user: OWNER, at: iso(-36) },
      { id: "c4000000-0000-4000-8000-000000000006", import_id: C, status: "received", note: "Recepción: 118 de 220 u. · faltan 2 · 2 dañadas · 1 sin contar", by_user: OWNER, at: iso(-15) },
    ],
  },
};
