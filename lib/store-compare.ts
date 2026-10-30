// Tienda × producto comparativo: el período elegido contra el anterior del mismo largo, para la
// estrategia comercial sin Excel: qué tiendas bajan o se frenaron, qué compra cada una, qué dejó
// de pedir y qué ofrecerle. Datos de `store_product_matrix` (migración 20261030225852_store_product_compare). Puro, para probarlo.

import type { MatrixCell, MatrixData, MatrixProduct, MatrixStore } from "./cross-sell.ts";

export type CmpStore = MatrixStore & {
  orders_prev: number;
  skus_prev: number;
  /** días con pedidos en el período */
  active_days: number;
  units: number;
  /** total vendido por la tienda en el período (moneda de la cuenta) */
  sales: number;
  /** día (fecha local de la cuenta) del último pedido */
  last_at: string | null;
  /** fecha local de hoy en la cuenta (YYYY-MM-DD) */
  today: string | null;
  /** último contacto (seguimiento) de los últimos 60 días y pedidos 7 días antes / 7 días desde ese día */
  fu_at: string | null;
  fu_before: number | null;
  fu_after: number | null;
};
/** p: pedidos en el período anterior; last_at: día (fecha local) del último pedido de ese producto. */
export type CmpCell = MatrixCell & { p: number; last_at: string | null };
export type CmpProduct = MatrixProduct & { orders_prev: number; stores: number; stores_prev: number };
export type CmpData = Omit<MatrixData, "stores" | "cells" | "products"> & { stores: CmpStore[]; cells: CmpCell[]; products: CmpProduct[] };

const n0 = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const s0 = (v: unknown) => (typeof v === "string" && v ? v : null);

/** Lo que llega de la base, con números y valores por defecto (sin la migración store_product_compare no hay período anterior). */
export function normalizeCompare(d: MatrixData): CmpData {
  type Raw = Record<string, unknown>;
  return {
    ...d,
    stores: d.stores.map((s) => {
      const r = s as unknown as Raw;
      return {
        ...s, orders: n0(s.orders), orders90: n0(s.orders90), skus: n0(s.skus),
        orders_prev: n0(r.orders_prev), skus_prev: n0(r.skus_prev), active_days: n0(r.active_days), units: n0(r.units), sales: n0(r.sales),
        last_at: s0(r.last_at), today: s0(r.today), fu_at: s0(r.fu_at),
        fu_before: r.fu_at ? n0(r.fu_before) : null, fu_after: r.fu_at ? n0(r.fu_after) : null,
      };
    }),
    cells: d.cells.map((c) => {
      const r = c as unknown as Raw;
      return { ...c, n: n0(c.n), n90: n0(c.n90), p: n0(r.p), last_at: s0(r.last_at) };
    }),
    products: d.products.map((p) => {
      const r = p as unknown as Raw;
      return { ...p, orders: n0(p.orders), orders90: n0(p.orders90), stores90: n0(p.stores90), orders_prev: n0(r.orders_prev), stores: n0(r.stores), stores_prev: n0(r.stores_prev) };
    }),
  };
}

// ─── Estado de cada tienda ───

export const TRENDS = [
  { id: "falling", label: "Bajando", tone: "danger", hint: "Pidió al menos 20% menos que en el período anterior" },
  { id: "stopped", label: "Se frenaron", tone: "danger", hint: "Pedían en el período anterior y en este no hicieron ninguno" },
  { id: "growing", label: "Creciendo", tone: "success", hint: "Pidieron al menos 20% más que en el período anterior" },
  { id: "back", label: "Volvieron", tone: "info", hint: "Sin pedidos en el período anterior, pero ya habían comprado antes" },
  { id: "new", label: "Nuevas", tone: "accent", hint: "Su primer pedido con Miranova fue en este período" },
  { id: "steady", label: "Estables", tone: "neutral", hint: "Cambio menor a 20%" },
  { id: "low", label: "Poco volumen", tone: "neutral", hint: "Menos de 5 pedidos en los dos períodos: muy poco para comparar" },
] as const;
export type Trend = (typeof TRENDS)[number]["id"];
export const isTrend = (v: unknown): v is Trend => TRENDS.some((t) => t.id === v);
export const trendInfo = (t: Trend) => TRENDS.find((x) => x.id === t)!;

export const COMPARE_RULES = {
  /** pedidos mínimos (en alguno de los dos períodos) para decir que sube o baja */
  minBase: 5,
  /** cambio que cuenta como subir o bajar */
  change: 0.2,
  /** pedidos del período anterior para decir que se frenó (con menos es poco volumen) */
  stoppedMin: 3,
  /** pedidos del período para decir que volvió (con uno solo es poco volumen) */
  backMin: 2,
  /** días que mide el efecto de un contacto (como en la ficha de la tienda) */
  impactDays: 7,
  /** producto del que depende la tienda: al menos esta parte de sus pedidos… */
  dominant: 0.5,
  /** …y solo con al menos estos pedidos (1 de 1 no es depender) */
  dominantMin: 5,
} as const;

/** Cambio relativo (0.25 = +25%); null si no hay base. */
export const pctChange = (cur: number, prev: number): number | null => (prev > 0 ? (cur - prev) / prev : null);

/**
 * Cómo va la tienda: nueva si su primer pedido con Miranova cae en el período; si no, compara el
 * período con el anterior del mismo largo.
 */
export function storeTrend(s: Pick<CmpStore, "orders" | "orders_prev">, firstAt: string | null | undefined, periodStart: string): Trend {
  const R = COMPARE_RULES;
  if (s.orders > 0 && firstAt && Date.parse(firstAt) >= Date.parse(periodStart)) return "new";
  if (s.orders === 0 && s.orders_prev >= R.stoppedMin) return "stopped";
  if (s.orders > 0 && s.orders_prev === 0) return s.orders >= R.backMin ? "back" : "low";
  if (Math.max(s.orders, s.orders_prev) < R.minBase) return "low";
  const c = (s.orders - s.orders_prev) / s.orders_prev;
  if (c <= -R.change) return "falling";
  if (c >= R.change) return "growing";
  return "steady";
}

// ─── Cuadrícula ───

export const SORTS = [
  { id: "pedidos", label: "Más pedidos" },
  { id: "caida", label: "Mayor caída" },
  { id: "subida", label: "Mayor crecimiento" },
] as const;
export type SortId = (typeof SORTS)[number]["id"];
export const isSort = (v: unknown): v is SortId => SORTS.some((s) => s.id === v);

export type CmpRow = {
  store: CmpStore;
  trend: Trend;
  change: number | null;
  delta: number;
  /** una por columna de producto */
  cells: { n: number; p: number }[];
  /** columna del producto principal de la tienda y si es dominante (≥ 50% de sus pedidos) */
  top: number | null;
  dominant: boolean;
};

export type CmpFilter = {
  /** fecha (ISO) en que empieza el período: para saber qué tiendas son nuevas */
  periodStart: string;
  /** primer pedido de cada tienda ("cuenta|tienda") */
  firstAt: Map<string, string | null>;
  trend?: Trend;
  /** product_key: solo tiendas que lo vendieron en alguno de los dos períodos */
  product?: string;
  q?: string;
  sort?: SortId;
};

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
const k2 = (a: string, b: string) => `${a}|${b}`;

/** Filas de una cuenta con su estado, antes de filtrar por estado (para contar cada uno). */
export function compareRows(data: CmpData, accountId: string, f: Omit<CmpFilter, "trend" | "sort">): { products: CmpProduct[]; rows: CmpRow[] } {
  const products = data.products
    .filter((p) => p.account_id === accountId && p.orders + p.orders_prev > 0)
    .sort((a, b) => b.orders - a.orders || b.orders_prev - a.orders_prev);
  const cells = new Map(data.cells.filter((c) => c.account_id === accountId).map((c) => [k2(c.store_id, c.product_key), c]));
  const needle = f.q ? norm(f.q) : "";
  const rows: CmpRow[] = [];
  for (const s of data.stores) {
    if (s.account_id !== accountId || s.orders + s.orders_prev === 0) continue;
    if (needle && !norm(s.name ?? "").includes(needle)) continue;
    if (f.product) {
      const c = cells.get(k2(s.store_id, f.product));
      if (!c || c.n + c.p === 0) continue;
    }
    const row = products.map((p) => {
      const c = cells.get(k2(s.store_id, p.product_key));
      return { n: c?.n ?? 0, p: c?.p ?? 0 };
    });
    let top: number | null = null;
    row.forEach((c, i) => {
      if (c.n > 0 && (top === null || c.n > row[top].n)) top = i;
    });
    rows.push({
      store: s,
      trend: storeTrend(s, f.firstAt.get(k2(s.account_id, s.store_id)), f.periodStart),
      change: pctChange(s.orders, s.orders_prev),
      delta: s.orders - s.orders_prev,
      cells: row,
      top,
      dominant: top !== null && s.orders >= COMPARE_RULES.dominantMin && row[top].n / s.orders >= COMPARE_RULES.dominant,
    });
  }
  return { products, rows };
}

export function sortRows(rows: CmpRow[], sort: SortId = "pedidos"): CmpRow[] {
  const by = {
    pedidos: (a: CmpRow, b: CmpRow) => b.store.orders - a.store.orders || b.store.orders_prev - a.store.orders_prev,
    caida: (a: CmpRow, b: CmpRow) => a.delta - b.delta || b.store.orders_prev - a.store.orders_prev,
    subida: (a: CmpRow, b: CmpRow) => b.delta - a.delta || b.store.orders - a.store.orders,
  }[sort];
  return [...rows].sort(by);
}

/** Cuántas tiendas hay en cada estado (para los filtros). */
export function trendCounts(rows: CmpRow[]): Record<Trend, number> {
  const out = Object.fromEntries(TRENDS.map((t) => [t.id, 0])) as Record<Trend, number>;
  for (const r of rows) out[r.trend]++;
  return out;
}

// ─── Una tienda: hábitos y oportunidades ───

export type ProductMove = "new" | "up" | "down" | "same" | "dropped";
export const MOVE_LABEL: Record<ProductMove, string> = { new: "nuevo", up: "subió", down: "bajó", same: "igual", dropped: "lo dejó" };

export function productMove(n: number, p: number): ProductMove {
  if (n > 0 && p === 0) return "new";
  if (n === 0 && p > 0) return "dropped";
  if (n > p) return "up";
  if (n < p) return "down";
  return "same";
}

export type Offer = { product_key: string; name: string; reason: string; share: number | null };

/**
 * Qué ofrecerle a una tienda: lo que venden las tiendas que comparten su producto principal y ella
 * nunca probó (90 días); si no hay pares, lo más vendido de la cuenta que todavía no vende.
 */
export function complements(data: CmpData, accountId: string, storeId: string, max = 3): Offer[] {
  const sold = new Map<string, Map<string, CmpCell>>();
  for (const c of data.cells) {
    if (c.account_id !== accountId || c.n90 <= 0) continue;
    if (!sold.has(c.store_id)) sold.set(c.store_id, new Map());
    sold.get(c.store_id)!.set(c.product_key, c);
  }
  const name = new Map(data.products.filter((p) => p.account_id === accountId).map((p) => [p.product_key, p.name]));
  const orders90 = new Map(data.products.filter((p) => p.account_id === accountId).map((p) => [p.product_key, p.orders90]));
  const mine = sold.get(storeId) ?? new Map<string, CmpCell>();
  const out: Offer[] = [];
  const anchor = [...mine.values()].sort((a, b) => b.n - a.n || b.n90 - a.n90)[0];
  if (anchor) {
    const peers = [...sold].filter(([sid, m]) => sid !== storeId && m.has(anchor.product_key));
    const count = new Map<string, number>();
    for (const [, m] of peers) for (const pk of m.keys()) if (!mine.has(pk)) count.set(pk, (count.get(pk) ?? 0) + 1);
    const anchorName = name.get(anchor.product_key) ?? anchor.product_key;
    for (const [pk, with_] of [...count].sort((a, b) => b[1] - a[1] || (orders90.get(b[0]) ?? 0) - (orders90.get(a[0]) ?? 0))) {
      if (out.length >= max || peers.length < 2 || with_ < 2 || with_ / peers.length < 0.34) break;
      out.push({ product_key: pk, name: name.get(pk) ?? pk, share: with_ / peers.length, reason: `${with_} de ${peers.length} tiendas que venden ${anchorName} también lo venden` });
    }
  }
  if (out.length === 0) {
    const best = data.products
      .filter((p) => p.account_id === accountId && !mine.has(p.product_key) && p.orders90 > 0)
      .sort((a, b) => b.orders90 - a.orders90)
      .slice(0, Math.min(2, max));
    for (const p of best) out.push({ product_key: p.product_key, name: p.name, share: null, reason: `De lo más vendido de la cuenta (${p.orders90} pedidos en 90 días) y nunca lo ha pedido` });
  }
  return out;
}

export type Habits = {
  store: CmpStore;
  trend: Trend;
  change: number | null;
  perDay: number;
  perDayPrev: number;
  activeDays: number;
  unitsPerOrder: number | null;
  ticket: number | null;
  daysSince: number | null;
  products: { product_key: string; name: string; n: number; p: number; move: ProductMove; last_at: string | null }[];
  dropped: { product_key: string; name: string; p: number; last_at: string | null }[];
  offer: Offer[];
  impact: { at: string; before: number; after: number; ready: boolean; daysLeft: number; change: number | null } | null;
};

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Hábitos de compra de una tienda en el período y lo que conviene ofrecerle. */
export function storeHabits(data: CmpData, accountId: string, storeId: string, f: Pick<CmpFilter, "periodStart" | "firstAt">): Habits | null {
  const s = data.stores.find((x) => x.account_id === accountId && x.store_id === storeId);
  if (!s) return null;
  const days = Math.max(1, data.days);
  const name = new Map(data.products.filter((p) => p.account_id === accountId).map((p) => [p.product_key, p.name]));
  const mine = data.cells.filter((c) => c.account_id === accountId && c.store_id === storeId && c.n + c.p > 0);
  const products = mine
    .map((c) => ({ product_key: c.product_key, name: name.get(c.product_key) ?? c.product_key, n: c.n, p: c.p, move: productMove(c.n, c.p), last_at: c.last_at }))
    .sort((a, b) => b.n - a.n || b.p - a.p);
  const today = s.today;
  const lastDay = s.last_at ? s.last_at.slice(0, 10) : null;
  let impact: Habits["impact"] = null;
  if (s.fu_at && today) {
    const elapsed = dayDiff(s.fu_at, today);
    const ready = elapsed >= COMPARE_RULES.impactDays;
    impact = {
      at: s.fu_at, before: s.fu_before ?? 0, after: s.fu_after ?? 0, ready, daysLeft: Math.max(0, COMPARE_RULES.impactDays - elapsed),
      change: ready ? pctChange(s.fu_after ?? 0, s.fu_before ?? 0) : null,
    };
  }
  return {
    store: s,
    trend: storeTrend(s, f.firstAt.get(k2(accountId, storeId)), f.periodStart),
    change: pctChange(s.orders, s.orders_prev),
    perDay: s.orders / days,
    perDayPrev: s.orders_prev / days,
    activeDays: s.active_days,
    unitsPerOrder: s.orders > 0 ? s.units / s.orders : null,
    ticket: s.orders > 0 ? s.sales / s.orders : null,
    daysSince: today && lastDay ? Math.max(0, dayDiff(lastDay, today)) : null,
    products,
    dropped: products.filter((p) => p.move === "dropped").map(({ product_key, name, p, last_at }) => ({ product_key, name, p, last_at })),
    offer: complements(data, accountId, storeId),
    impact,
  };
}

// ─── Un producto: quién lo dejó y quién lo empezó ───

export type ProductFocus = {
  product: CmpProduct;
  started: { store: CmpStore; n: number }[];
  dropped: { store: CmpStore; p: number; last_at: string | null }[];
  down: { store: CmpStore; n: number; p: number }[];
  up: { store: CmpStore; n: number; p: number }[];
};

export function productFocus(data: CmpData, accountId: string, productKey: string): ProductFocus | null {
  const product = data.products.find((p) => p.account_id === accountId && p.product_key === productKey);
  if (!product) return null;
  const stores = new Map(data.stores.filter((s) => s.account_id === accountId).map((s) => [s.store_id, s]));
  const out: ProductFocus = { product, started: [], dropped: [], down: [], up: [] };
  for (const c of data.cells) {
    if (c.account_id !== accountId || c.product_key !== productKey) continue;
    const store = stores.get(c.store_id);
    if (!store) continue;
    const m = productMove(c.n, c.p);
    if (m === "new") out.started.push({ store, n: c.n });
    else if (m === "dropped") out.dropped.push({ store, p: c.p, last_at: c.last_at });
    else if (m === "down") out.down.push({ store, n: c.n, p: c.p });
    else if (m === "up") out.up.push({ store, n: c.n, p: c.p });
  }
  out.started.sort((a, b) => b.n - a.n);
  out.dropped.sort((a, b) => b.p - a.p);
  out.down.sort((a, b) => a.n - a.p - (b.n - b.p));
  out.up.sort((a, b) => b.n - b.p - (a.n - a.p));
  return out;
}

/** Fecha ISO en que empieza el período (para "nuevas"): ahora − días. */
export const periodStartIso = (days: number, now = Date.now()) => new Date(now - days * 86_400_000).toISOString();
