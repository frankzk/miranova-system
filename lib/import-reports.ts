// Importaciones: estadísticas por proveedor y reportes (dinero en camino, gasto por mes, historial
// del costo por unidad). Puro, sin base de datos, para probarlo. Todo en USD.
import { counted, isActive, landedCosts, type CostItem, type CostLine } from "./imports.ts";

export type RImport = {
  id: string; code: string; supplier_id: string | null; supplier: string | null; dest_country: string; status: string;
  ordered_at: string | null; created_at: string; eta: string | null; arrived_at: string | null;
};
export type RItem = CostItem & { import_id: string; account_id: string | null; product_external_id: string | null; name: string; sku: string | null };
export type RCost = CostLine & { import_id: string };
export type RPayment = { import_id: string; paid_at: string; amount: number };

const DAY = 86_400_000;
const n = (v: unknown) => Number(v) || 0;
/** Día del pedido (o de creación). */
export const orderedDay = (i: Pick<RImport, "ordered_at" | "created_at">) => (i.ordered_at ?? i.created_at).slice(0, 10);
const between = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / DAY);
const group = <T, K>(rows: T[], key: (r: T) => K) => {
  const m = new Map<K, T[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return m;
};
/** Cotizaciones y canceladas no cuentan como compras. */
const bought = (i: RImport) => i.status !== "quote" && i.status !== "cancelled";

/** Costo total y por línea de cada importación. */
export function costsByImport(imports: RImport[], items: RItem[], costs: RCost[]) {
  const its = group(items, (i) => i.import_id);
  const cos = group(costs, (c) => c.import_id);
  return new Map(imports.map((i) => [i.id, landedCosts(its.get(i.id) ?? [], cos.get(i.id) ?? [])]));
}

export type SupplierStat = {
  imports: number;
  /** importaciones compradas (sin cotizaciones ni canceladas) */
  bought: number;
  last: string | null;
  units: number;
  spent: number;
  /** días promedio del pedido a la llegada (importaciones que ya llegaron) */
  leadDays: number | null;
  leadSamples: number;
  /** parte de las que llegaron a tiempo (llegada ≤ estimada) */
  onTime: number | null;
  /** faltantes + dañadas sobre lo pedido, en lo que se contó al recibir */
  lossRate: number | null;
  products: { name: string; units: number }[];
};

export function supplierStats(imports: RImport[], items: RItem[], costs: RCost[]): Map<string, SupplierStat> {
  const landed = costsByImport(imports, items, costs);
  const its = group(items, (i) => i.import_id);
  const out = new Map<string, SupplierStat>();
  for (const [sid, list] of group(imports.filter((i) => i.supplier_id), (i) => i.supplier_id!)) {
    const real = list.filter(bought);
    const lines = real.flatMap((i) => its.get(i.id) ?? []);
    const arrived = real.filter((i) => i.arrived_at);
    const leads = arrived.map((i) => between(orderedDay(i), i.arrived_at!)).filter((d) => d >= 0);
    const withEta = arrived.filter((i) => i.eta);
    const countedLines = lines.filter(counted);
    const ordered = countedLines.reduce((t, l) => t + n(l.qty), 0);
    const loss = countedLines.reduce((t, l) => t + Math.max(0, n(l.qty) - n(l.received_qty)) + n(l.damaged_qty), 0);
    const byProduct = new Map<string, number>();
    for (const l of lines) byProduct.set(l.name, (byProduct.get(l.name) ?? 0) + n(l.qty));
    out.set(sid, {
      imports: list.length,
      bought: real.length,
      last: list.map(orderedDay).sort().pop() ?? null,
      units: lines.reduce((t, l) => t + n(l.qty), 0),
      spent: real.reduce((t, i) => t + (landed.get(i.id)?.totals.total ?? 0), 0),
      leadDays: leads.length ? leads.reduce((a, b) => a + b, 0) / leads.length : null,
      leadSamples: leads.length,
      onTime: withEta.length ? withEta.filter((i) => i.arrived_at!.slice(0, 10) <= i.eta!).length / withEta.length : null,
      lossRate: ordered > 0 ? loss / ordered : null,
      products: [...byProduct].map(([name, units]) => ({ name, units })).sort((a, b) => b.units - a.units).slice(0, 5),
    });
  }
  return out;
}

/** Lo que está comprado y todavía no llega a la bodega. */
export function moneyInTransit(imports: RImport[], items: RItem[], costs: RCost[], payments: RPayment[]) {
  const landed = costsByImport(imports, items, costs);
  const active = imports.filter((i) => isActive(i.status) && i.status !== "quote");
  const paidBy = new Map<string, number>();
  for (const p of payments) paidBy.set(p.import_id, (paidBy.get(p.import_id) ?? 0) + n(p.amount));
  const byCountry = new Map<string, { country: string; count: number; total: number }>();
  let total = 0, paid = 0, units = 0;
  for (const i of active) {
    const t = landed.get(i.id)?.totals;
    total += t?.total ?? 0;
    units += t?.units ?? 0;
    paid += paidBy.get(i.id) ?? 0;
    const c = byCountry.get(i.dest_country) ?? { country: i.dest_country, count: 0, total: 0 };
    c.count++;
    c.total += t?.total ?? 0;
    byCountry.set(i.dest_country, c);
  }
  return { count: active.length, units, total, paid, due: Math.max(0, total - paid), byCountry: [...byCountry.values()].sort((a, b) => b.total - a.total) };
}

/** Los últimos `count` meses (YYYY-MM), del más viejo al actual. */
export function lastMonths(today: string, count = 12): string[] {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: count }, (_, k) => {
    const d = new Date(Date.UTC(y, m - 1 - (count - 1 - k), 1));
    return d.toISOString().slice(0, 7);
  });
}

/** Por mes: lo comprado (costo total de las importaciones pedidas ese mes) y lo pagado (pagos de ese mes). */
export function monthlySpend(imports: RImport[], items: RItem[], costs: RCost[], payments: RPayment[], months: string[]) {
  const landed = costsByImport(imports, items, costs);
  const rows = new Map(months.map((m) => [m, { month: m, bought: 0, paid: 0, imports: 0 }]));
  for (const i of imports.filter(bought)) {
    const r = rows.get(orderedDay(i).slice(0, 7));
    if (!r) continue;
    r.bought += landed.get(i.id)?.totals.total ?? 0;
    r.imports++;
  }
  const valid = new Set(imports.filter((i) => i.status !== "cancelled").map((i) => i.id));
  for (const p of payments) {
    const r = rows.get(p.paid_at.slice(0, 7));
    if (r && valid.has(p.import_id)) r.paid += n(p.amount);
  }
  return [...rows.values()];
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Mismo producto en distintas importaciones: el de Drop, o por nombre si es nuevo. */
export const productKeyOf = (i: Pick<RItem, "account_id" | "product_external_id" | "name">) =>
  i.account_id && i.product_external_id ? `${i.account_id}:${i.product_external_id}` : `name:${norm(i.name)}`;

export type CostPoint = { import_id: string; code: string; day: string; supplier: string | null; qty: number; good: number; unit: number };
export type CostHistory = { key: string; name: string; sku: string | null; points: CostPoint[]; last: CostPoint; prev: CostPoint | null; change: number | null };

/** Costo final por unidad de cada producto en cada importación comprada, del más reciente al más viejo. */
export function unitCostHistory(imports: RImport[], items: RItem[], costs: RCost[]): CostHistory[] {
  const real = imports.filter(bought);
  const landed = costsByImport(real, items, costs);
  const byId = new Map(real.map((i) => [i.id, i]));
  const points = new Map<string, { name: string; sku: string | null; points: CostPoint[] }>();
  for (const it of items) {
    const imp = byId.get(it.import_id);
    const lc = imp && landed.get(imp.id)?.items.find((x) => x.id === it.id);
    if (!imp || !lc || lc.good <= 0) continue;
    const key = productKeyOf(it);
    const cur = points.get(key) ?? { name: it.name, sku: it.sku, points: [] };
    cur.points.push({ import_id: imp.id, code: imp.code, day: orderedDay(imp), supplier: imp.supplier, qty: lc.qty, good: lc.good, unit: lc.unit });
    points.set(key, cur);
  }
  return [...points].map(([key, v]) => {
    const pts = v.points.sort((a, b) => b.day.localeCompare(a.day) || b.code.localeCompare(a.code));
    const [last, prev] = pts;
    return { key, name: v.name, sku: v.sku, points: pts, last, prev: prev ?? null, change: prev && prev.unit > 0 ? last.unit / prev.unit - 1 : null };
  }).sort((a, b) => b.last.day.localeCompare(a.last.day) || a.name.localeCompare(b.name));
}
