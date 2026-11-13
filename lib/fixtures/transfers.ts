// Simulación local de Compras › Traslados: bodegas, traslados (en camino, llegado con merma, preparando y uno
// vencido), sus llegadas y un manifiesto.
import type { FixtureModule, Row } from "./types";

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const day = (days: number) => new Date(Date.now() - days * DAY - 6 * 3_600_000).toISOString().slice(0, 10);
const OWNER = "a0000000-0000-4000-8000-000000000001";

const P = (n: number, code: string, name: string, country: string, extra: Row = {}): Row => ({
  id: `d0000000-0000-4000-8000-00000000000${n}`, code, name, country, city: null, goods: "both", is_origin: false, is_destination: true, accounts: [],
  active: true, position: n * 10, created_at: at(30), updated_at: at(30), ...extra,
});
const transfer_points: Row[] = [
  P(1, "boxful_gt", "Boxful Guatemala", "GT", { city: "Ciudad de Guatemala", is_origin: true, accounts: ["miranova_gt"] }),
  P(2, "moi_gt", "Bodega de Moi", "GT", { goods: "maquila", is_origin: true, accounts: ["dropi_gt"] }),
  P(3, "mireva_tgu", "Mireva · Tegucigalpa", "HN", { city: "Tegucigalpa", accounts: ["mireva_hn"] }),
  P(4, "miranova_sps", "Miranova · San Pedro Sula", "HN", { city: "San Pedro Sula", accounts: ["miranova_hn"] }),
  P(5, "alex_sv", "Bodega de Alex", "SV", { goods: "maquila", accounts: ["miranova_sv"] }),
  P(6, "boxful_sv", "Boxful El Salvador", "SV", { goods: "import" }),
  P(7, "bodega_cr", "Bodega Costa Rica", "CR", { is_origin: true, accounts: ["miranova_cr", "mireva_cr", "dropi_cr"] }),
];
const pt = (code: string) => transfer_points.find((p) => p.code === code)!.id as string;

const T = (n: number, r: Row): Row => ({
  id: `c1000000-0000-4000-8000-00000000000${n}`, code: `TR-2026-00${n}`, carrier: null, reference: null, shipped_at: null, eta: null, notes: null,
  created_by: OWNER, created_at: at(r.days ?? 1), updated_at: at(r.days ?? 1), ...r,
});
const transfers: Row[] = [
  T(1, { days: 4, origin_id: pt("boxful_gt"), dest_country: "HN", carrier: "Boxful", reference: "MAN-4471", status: "transit", shipped_at: day(3), eta: day(-1) }),
  T(2, { days: 12, origin_id: pt("boxful_gt"), dest_country: "SV", carrier: "Boxful", reference: "MAN-4402", status: "arrived", shipped_at: day(11), eta: day(8) }),
  T(3, { days: 1, origin_id: pt("boxful_gt"), dest_country: "CR", carrier: "Boxful", status: "preparing" }),
  T(4, { days: 7, origin_id: pt("moi_gt"), dest_country: "HN", carrier: "Moi", status: "transit", shipped_at: day(6), eta: day(2) }),
];
const tr = (n: number) => transfers[n - 1].id as string;

let pos = 0;
const I = (n: number, t: number, dest: string, kind: string, name: string, qty: number, extra: Row = {}): Row => ({
  id: `c2000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`, transfer_id: tr(t), dest_id: pt(dest), kind, name, sku: null, account_id: null,
  product_external_id: null, image_url: null, qty, source: null, received_qty: null, damaged_qty: 0, received_note: null, position: pos++, created_at: at(4), ...extra,
});
const transfer_items: Row[] = [
  I(1, 1, "miranova_sps", "import", "Drenaje Linfático en Gotas", 250, { source: "req:e0000000-0000-4000-8000-000000000001:drenaje linfatico en gotas:HN" }),
  I(2, 1, "miranova_sps", "import", "Cinturón sin hebilla", 250),
  I(3, 1, "miranova_sps", "import", "Autogrip", 250),
  I(4, 1, "mireva_tgu", "maquila", "Drenaje linfático Maya Verra", 100, { source: "lab:f0000000-0000-4000-8000-000000000001:mireva_hn", received_qty: 100 }),
  I(5, 2, "alex_sv", "maquila", "Drenaje linfático Maya Verra", 100, { source: "lab:f0000000-0000-4000-8000-000000000001:miranova_sv", received_qty: 98, damaged_qty: 1, received_note: "Una caja golpeada" }),
  I(6, 2, "boxful_sv", "import", "Cinturón sin hebilla", 250, { received_qty: 250 }),
  I(7, 2, "boxful_sv", "import", "Autogrip", 250, { received_qty: 246, received_note: "Faltaron 4 en el bulto 3" }),
  I(8, 3, "bodega_cr", "import", "Mini ventilador portátil", 120),
  I(9, 4, "miranova_sps", "maquila", "Gotas de magnesio", 100, { source: "lab:f0000000-0000-4000-8000-000000000003:miranova_hn" }),
];

const transfer_arrivals: Row[] = [
  { transfer_id: tr(1), dest_id: pt("mireva_tgu"), arrived_at: day(1), note: null, received_by: OWNER, created_at: at(1) },
  { transfer_id: tr(2), dest_id: pt("alex_sv"), arrived_at: day(8), note: "Cotejado con Dannis", received_by: OWNER, created_at: at(8) },
  { transfer_id: tr(2), dest_id: pt("boxful_sv"), arrived_at: day(8), note: null, received_by: OWNER, created_at: at(8) },
];

const transfer_documents: Row[] = [
  { id: "c3000000-0000-4000-8000-000000000001", transfer_id: tr(2), kind: "manifest", storage_path: `${tr(2)}/c3000000-0000-4000-8000-000000000001.pdf`, filename: "manifiesto-4402.pdf", content_type: "application/pdf", size_bytes: 92_000, uploaded_by: OWNER, created_at: at(11) },
];

const E = (n: number, t: number, days: number, note: string): Row => ({ id: `c4000000-0000-4000-8000-00000000000${n}`, transfer_id: tr(t), note, by_user: OWNER, at: at(days) });
const transfer_events: Row[] = [
  E(1, 1, 4, "Traslado creado"), E(2, 1, 3, `Salió el ${day(3)}; llegada estimada ${day(-1)}`), E(3, 1, 1, `Llegó a Mireva · Tegucigalpa el ${day(1)}: 100 de 100 u.`),
  E(4, 2, 12, "Traslado creado"), E(5, 2, 8, `Llegó a Bodega de Alex el ${day(8)}: 98 de 100 u., merma 2, 1 dañadas`),
  E(6, 3, 1, "Traslado creado"), E(7, 4, 7, "Traslado creado"),
];

export const fixtures: FixtureModule = {
  tables: { transfer_points, transfers, transfer_items, transfer_arrivals, transfer_documents, transfer_events, transfer_settled: [] },
};
