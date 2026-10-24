// Rentabilidad: ficha de costos por producto (costos comunes y, por cuenta, traslado y precios) y
// la utilidad real de lo entregado en Drop. Sin base de datos ni Next: sirve en servidor, cliente
// y pruebas. Todo se lleva a dólares: los costos, con el tipo de cambio de la ficha; lo cobrado en
// cada cuenta, con el de la plataforma (account_fx).

/** Fulfillment de Drop por pedido: fijo en todos los países. */
export const FULFILLMENT_USD = 1.2;

export const COST_CURRENCIES = [
  { id: "USD", label: "Dólares", symbol: "$" },
  { id: "GTQ", label: "Quetzales", symbol: "Q" },
] as const;
export type CostCurrency = (typeof COST_CURRENCIES)[number]["id"];
export const isCostCurrency = (v: unknown): v is CostCurrency => COST_CURRENCIES.some((c) => c.id === v);
export const costSymbol = (c: CostCurrency) => (c === "GTQ" ? "Q" : "$");

/** Quién lleva la mercadería de Guatemala al país de la cuenta. */
export const CARRIERS = [
  { id: "raulito", label: "Transporte Raulito" },
  { id: "castaneda", label: "Castañeda" },
  { id: "otro", label: "Otro" },
] as const;
export type Carrier = (typeof CARRIERS)[number]["id"];
export const isCarrier = (v: unknown): v is Carrier => CARRIERS.some((c) => c.id === v);
export const carrierLabel = (c: Carrier | null) => CARRIERS.find((x) => x.id === c)?.label ?? null;

/** El producto en una cuenta: traslado (moneda de costos de la ficha) y precios (moneda de la cuenta). */
export type ProfitMarket = {
  account_id: string;
  carrier: Carrier | null;
  transfer_cost: number | null;
  price_community: number | null;
  price_users: number | null;
  qty_in: number | null;
};

/** Producto de la plataforma (cuenta + product_key, como en line_facts) que corresponde a la ficha. */
export type ProfitLink = { account_id: string; product_key: string };

export type ProfitProduct = {
  id: string;
  name: string;
  cost_currency: CostCurrency;
  /** Quetzales por dólar, si los costos están en quetzales. */
  fx_gtq_per_usd: number | null;
  /** Costo por unidad, costo de importación por unidad (de ser el caso) y recolección en Guatemala. */
  unit_cost: number | null;
  import_cost: number | null;
  pickup_cost: number | null;
  notes: string | null;
  markets: ProfitMarket[];
  links: ProfitLink[];
};

/** Cuenta con su moneda y dólares por unidad de esa moneda (null si no se conoce). */
export type MarketAccount = { id: string; name: string; country: string | null; currency: string; usd_rate: number | null };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Monto en la moneda de costos de la ficha → dólares (null si falta el monto o el tipo de cambio). */
export function costToUsd(p: Pick<ProfitProduct, "cost_currency" | "fx_gtq_per_usd">, n: number | null | undefined): number | null {
  if (n === null || n === undefined) return null;
  if (p.cost_currency === "USD") return n;
  return p.fx_gtq_per_usd && p.fx_gtq_per_usd > 0 ? n / p.fx_gtq_per_usd : null;
}

export type UnitCosts = {
  /** costo + importación */
  cost_total: number | null;
  pickup: number;
  transfer: number;
  /** puesto en el país: costo total + recolección + traslado (null si falta el costo) */
  landed: number | null;
};

/** Costos por unidad en dólares; sin cuenta, sin traslado. */
export function unitCosts(p: Omit<ProfitProduct, "id" | "name" | "notes" | "markets" | "links">, m?: Pick<ProfitMarket, "transfer_cost"> | null): UnitCosts {
  const base = p.unit_cost === null ? null : costToUsd(p, p.unit_cost + (p.import_cost ?? 0));
  const pickup = costToUsd(p, p.pickup_cost ?? 0) ?? 0;
  const transfer = costToUsd(p, m?.transfer_cost ?? 0) ?? 0;
  return { cost_total: base, pickup, transfer, landed: base === null ? null : base + pickup + transfer };
}

export type UnitProfit = { price_usd: number; profit: number; margin: number | null };

/** Lo que deja una unidad vendida a `price` (moneda de la cuenta): precio − puesto − fulfillment. */
export function unitProfit(landed: number | null, price: number | null, usdRate: number | null): UnitProfit | null {
  if (landed === null || price === null || !usdRate) return null;
  const price_usd = price * usdRate;
  const profit = price_usd - landed - FULFILLMENT_USD;
  return { price_usd, profit, margin: price_usd > 0 ? profit / price_usd : null };
}

export type MarketEconomics = UnitCosts & {
  fulfillment: number;
  community: UnitProfit | null;
  users: UnitProfit | null;
  /** cantidad ingresada × puesto en el país */
  investment: number | null;
};

export function marketEconomics(p: ProfitProduct, m: ProfitMarket, usdRate: number | null): MarketEconomics {
  const c = unitCosts(p, m);
  return {
    ...c,
    fulfillment: FULFILLMENT_USD,
    community: unitProfit(c.landed, m.price_community, usdRate),
    users: unitProfit(c.landed, m.price_users, usdRate),
    investment: c.landed === null || m.qty_in === null ? null : m.qty_in * c.landed,
  };
}

// ─── Formulario ───

const MAX_MONEY = 10_000_000;

/** "1,234.50", "$12", "Q 12.5", "L236" → número; "" → null; texto que no es número → NaN. */
export function parseMoney(s: string | undefined): number | null {
  const t = (s ?? "").trim();
  if (!t) return null;
  const clean = t.replace(/^(us\$|\$|q|l|₡|c\$)\s*/i, "").replace(/[,\s]/g, "");
  return /^\d+(\.\d+)?$|^\.\d+$/.test(clean) ? Number(clean) : NaN;
}

export type MarketInput = { carrier?: string; transfer_cost?: string; price_community?: string; price_users?: string; qty_in?: string };
export type ProfitInput = {
  name?: string; cost_currency?: string; fx_gtq_per_usd?: string; unit_cost?: string; import_cost?: string; pickup_cost?: string; notes?: string;
  markets?: Record<string, MarketInput>;
  /** "cuenta|product_key" de cada producto de la plataforma que es esta ficha */
  links?: string[];
};
export type ProfitFields = Omit<ProfitProduct, "id" | "markets" | "links">;
export type CleanProfit = { ok: true; row: ProfitFields; markets: ProfitMarket[]; links: ProfitLink[] } | { ok: false; msg: string };

/** Valida el formulario de una ficha: nombre, costos, tipo de cambio y, por cuenta, traslado y precios. */
export function cleanProfitProduct(input: ProfitInput, accounts: Pick<MarketAccount, "id" | "name">[]): CleanProfit {
  const fail = (msg: string): CleanProfit => ({ ok: false, msg });
  const name = (input.name ?? "").replace(/\s+/g, " ").trim();
  if (!name) return fail("Escribe el nombre del producto.");
  if (name.length > 160) return fail("El nombre es demasiado largo (máximo 160 caracteres).");
  const cost_currency = isCostCurrency(input.cost_currency) ? input.cost_currency : "USD";

  const money = (label: string, s: string | undefined, prefix = ""): { ok: true; n: number | null } | { ok: false; msg: string } => {
    const n = parseMoney(s);
    if (n === null) return { ok: true, n: null };
    if (!Number.isFinite(n)) return { ok: false, msg: `${prefix}${label} debe ser un número (por ejemplo 3.50).` };
    if (n > MAX_MONEY) return { ok: false, msg: `${prefix}${label} es demasiado alto.` };
    return { ok: true, n: Math.round(n * 10_000) / 10_000 };
  };

  let fx: number | null = null;
  if (cost_currency === "GTQ") {
    const r = money("El tipo de cambio", input.fx_gtq_per_usd);
    if (!r.ok) return fail(r.msg);
    if (r.n === null || r.n <= 0) return fail("Escribe el tipo de cambio: cuántos quetzales vale un dólar (por ejemplo 7.65).");
    if (r.n < 1 || r.n > 50) return fail("El tipo de cambio no parece correcto: son quetzales por dólar (por ejemplo 7.65).");
    fx = r.n;
  }
  const cost = money("El costo", input.unit_cost);
  if (!cost.ok) return fail(cost.msg);
  const imp = money("El costo de importación", input.import_cost);
  if (!imp.ok) return fail(imp.msg);
  const pick = money("La recolección en Guatemala", input.pickup_cost);
  if (!pick.ok) return fail(pick.msg);
  const notes = (input.notes ?? "").trim();
  if (notes.length > 2000) return fail("Las notas son demasiado largas (máximo 2000 caracteres).");

  const markets: ProfitMarket[] = [];
  for (const a of accounts) {
    const m = input.markets?.[a.id];
    if (!m) continue;
    const pre = `${a.name}: `;
    const transfer = money("el traslado", m.transfer_cost, pre);
    if (!transfer.ok) return fail(transfer.msg);
    const pc = money("el precio comunidad", m.price_community, pre);
    if (!pc.ok) return fail(pc.msg);
    const pu = money("el precio usuarios", m.price_users, pre);
    if (!pu.ok) return fail(pu.msg);
    const qtyText = (m.qty_in ?? "").replace(/[,\s]/g, "");
    if (qtyText && !/^\d+$/.test(qtyText)) return fail(`${pre}la cantidad ingresada debe ser un número entero.`);
    const qty = qtyText ? Number(qtyText) : null;
    if (qty !== null && qty > MAX_MONEY) return fail(`${pre}la cantidad ingresada es demasiado alta.`);
    const carrier = isCarrier(m.carrier) ? m.carrier : null;
    const round = (n: number | null) => (n === null ? null : round2(n));
    const row: ProfitMarket = { account_id: a.id, carrier, transfer_cost: transfer.n, price_community: round(pc.n), price_users: round(pu.n), qty_in: qty };
    if (carrier || row.transfer_cost !== null || row.price_community !== null || row.price_users !== null || row.qty_in !== null) markets.push(row);
  }

  const known = new Set(accounts.map((a) => a.id));
  const links = new Map<string, ProfitLink>();
  for (const v of input.links ?? []) {
    const i = v.indexOf("|");
    const account_id = v.slice(0, i);
    const product_key = v.slice(i + 1).trim();
    if (i < 1 || !known.has(account_id) || !product_key || product_key.length > 200) continue;
    links.set(`${account_id}|${product_key}`, { account_id, product_key });
  }

  return {
    ok: true,
    row: { name, cost_currency, fx_gtq_per_usd: fx, unit_cost: cost.n, import_cost: imp.n, pickup_cost: pick.n, notes: notes || null },
    markets,
    links: [...links.values()],
  };
}

// ─── Coincidencias de nombres entre cuentas ───

const STOP = new Set(["de", "del", "la", "las", "el", "los", "con", "para", "por", "en", "y", "a", "x", "ml", "mg", "g", "pack"]);
const tokens = (s: string) =>
  new Set(
    s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ")
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
export const normName = (s: string) => [...tokens(s)].join(" ");

/** Qué tanto se parecen dos nombres de producto (0 a 1): palabras en común sobre las del más corto. */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const w of ta) if (tb.has(w)) common++;
  return common / Math.min(ta.size, tb.size);
}

export type CatalogItem = { account_id: string; product_key: string; name: string };

/**
 * El producto de cada cuenta que más se parece al nombre (si se parece lo suficiente), para
 * vincular una ficha nueva sin buscarlo a mano. Los que ya están en otra ficha no se proponen.
 */
export function suggestLinks(name: string, catalog: CatalogItem[], taken: Set<string> = new Set(), min = 0.6): Map<string, CatalogItem> {
  const best = new Map<string, { item: CatalogItem; score: number }>();
  for (const item of catalog) {
    if (taken.has(`${item.account_id}|${item.product_key}`)) continue;
    const score = nameSimilarity(name, item.name);
    if (score < min) continue;
    const cur = best.get(item.account_id);
    if (!cur || score > cur.score) best.set(item.account_id, { item, score });
  }
  return new Map([...best].map(([k, v]) => [k, v.item]));
}

// ─── Lo entregado ───

/** Una fila de profit_delivered: día × cuenta × producto × precio por unidad. */
export type DeliveredRow = {
  d: string; a: string; k: string;
  /** precio por unidad que cobró el proveedor (moneda de la cuenta) */
  p: number;
  u: number;
  /** lo que cobró el proveedor (moneda de la cuenta) */
  v: number;
  /** lo que descontó la plataforma (moneda de la cuenta) */
  f: number | null;
  /** parte de pedidos sin ese dato: se cuenta el fulfillment fijo */
  x: number | null;
  n: number;
};
export type Delivered = { rows: DeliveredRow[]; orders: { d: string; a: string; n: number }[]; names: Record<string, string> };

/**
 * Precios que más se cobraron de un producto en una cuenta (por unidades), de menor a mayor: el
 * menor suele ser el de comunidad y el mayor el de usuarios. Para proponerlos en la ficha.
 */
export function observedPrices(rows: DeliveredRow[], account: string, key: string, since: string): number[] {
  return observedAll(rows.filter((r) => r.a === account && r.k === key), since)[`${account}|${key}`] ?? [];
}

/** Lo mismo para todos los productos: "cuenta|product_key" → precios. */
export function observedAll(rows: DeliveredRow[], since: string): Record<string, number[]> {
  const byKey = new Map<string, Map<number, number>>();
  for (const r of rows) {
    if (r.d < since || r.p <= 0) continue;
    const k = `${r.a}|${r.k}`;
    const units = byKey.get(k) ?? new Map<number, number>();
    units.set(r.p, (units.get(r.p) ?? 0) + r.u);
    byKey.set(k, units);
  }
  return Object.fromEntries(
    [...byKey].map(([k, units]) => [k, [...units].sort((x, y) => y[1] - x[1]).slice(0, 2).map(([p]) => p).sort((x, y) => x - y)]),
  );
}

/** Sumas en dólares. Costo y utilidad, solo de lo que tiene costo cargado en su ficha. */
export type Acc = {
  orders: number;
  units: number;
  revenue: number;
  fees: number;
  covered_units: number;
  covered_revenue: number;
  covered_fees: number;
  cost: number;
  profit: number;
  /** unidades cobradas a precio de comunidad o de usuarios (si la ficha tiene los dos precios) */
  community_units: number;
  users_units: number;
};
export const emptyAcc = (): Acc => ({
  orders: 0, units: 0, revenue: 0, fees: 0, covered_units: 0, covered_revenue: 0, covered_fees: 0, cost: 0, profit: 0, community_units: 0, users_units: 0,
});
const ACC_KEYS = Object.keys(emptyAcc()) as (keyof Acc)[];
/** Suma `x` en `t` (solo las cifras: `t` puede traer más campos, como el nombre de la ficha). */
export function addAcc<T extends Acc>(t: T, x: Acc): T {
  for (const k of ACC_KEYS) t[k] += x[k];
  return t;
}
/** Utilidad sobre lo cobrado de lo que tiene costo. */
export const margin = (a: Pick<Acc, "profit" | "covered_revenue">) => (a.covered_revenue > 0 ? a.profit / a.covered_revenue : null);
/** Parte de lo entregado (en dólares) que tiene costo cargado. */
export const coverage = (a: Pick<Acc, "revenue" | "covered_revenue">) => (a.revenue > 0 ? a.covered_revenue / a.revenue : null);

type CostRef = { product: ProfitProduct; landed: number | null; cut: number | null };

/** cuenta|product_key → ficha, con el costo puesto en ese país y el precio que separa comunidad de usuarios. */
export function costIndex(products: ProfitProduct[]): Map<string, CostRef> {
  const out = new Map<string, CostRef>();
  for (const p of products) {
    for (const l of p.links) {
      const m = p.markets.find((x) => x.account_id === l.account_id) ?? null;
      const cut = m && m.price_community !== null && m.price_users !== null && m.price_users > m.price_community
        ? (m.price_community + m.price_users) / 2
        : null;
      out.set(`${l.account_id}|${l.product_key}`, { product: p, landed: unitCosts(p, m).landed, cut });
    }
  }
  return out;
}

/** Una fila en dólares, con su costo si la ficha lo tiene. */
function rowAcc(r: DeliveredRow, ref: CostRef | undefined, rate: number | null): Acc {
  const a = emptyAcc();
  a.units = r.u;
  if (!rate) return a;
  a.revenue = r.v * rate;
  a.fees = (r.f ?? 0) * rate + (r.x ?? 0) * FULFILLMENT_USD;
  if (ref && ref.landed !== null) {
    a.covered_units = r.u;
    a.covered_revenue = a.revenue;
    a.covered_fees = a.fees;
    a.cost = r.u * ref.landed;
    a.profit = a.revenue - a.fees - a.cost;
  }
  if (ref?.cut !== null && ref?.cut !== undefined) {
    if (r.p <= ref.cut) a.community_units = r.u;
    else a.users_units = r.u;
  }
  return a;
}

export type Filter = { from: string; to: string; account?: string };
const inFilter = (d: string, a: string, f: Filter) => d >= f.from && d <= f.to && (!f.account || a === f.account);

export type ProductLine = Acc & { id: string; name: string; has_cost: boolean; accounts: string[] };
export type UnlinkedLine = { account_id: string; key: string; name: string; units: number; revenue: number; orders: number };
export type AccountLine = Acc & { account_id: string };
export type Realized = { totals: Acc; products: ProductLine[]; unlinked: UnlinkedLine[]; accounts: AccountLine[] };

/** Utilidad real de lo entregado en el período: totales, por ficha, por cuenta y lo que no tiene ficha. */
export function realize(data: Delivered, products: ProfitProduct[], rates: Map<string, number | null>, f: Filter): Realized {
  const index = costIndex(products);
  const totals = emptyAcc();
  const byProduct = new Map<string, ProductLine>();
  const byAccount = new Map<string, AccountLine>();
  const unlinked = new Map<string, UnlinkedLine>();
  for (const r of data.rows) {
    if (!inFilter(r.d, r.a, f)) continue;
    const ref = index.get(`${r.a}|${r.k}`);
    const rate = rates.get(r.a) ?? null;
    const x = rowAcc(r, ref, rate);
    addAcc(totals, x);
    const acc = byAccount.get(r.a) ?? { ...emptyAcc(), account_id: r.a };
    byAccount.set(r.a, addAcc(acc, x));
    if (ref) {
      const line = byProduct.get(ref.product.id) ?? { ...emptyAcc(), id: ref.product.id, name: ref.product.name, has_cost: false, accounts: [] };
      addAcc(line, x);
      line.orders += r.n;
      if (ref.landed !== null) line.has_cost = true;
      if (!line.accounts.includes(r.a)) line.accounts.push(r.a);
      byProduct.set(ref.product.id, line);
    } else {
      const key = `${r.a}|${r.k}`;
      const u = unlinked.get(key) ?? { account_id: r.a, key: r.k, name: data.names[`${r.a}:${r.k}`] ?? r.k, units: 0, revenue: 0, orders: 0 };
      u.units += x.units;
      u.revenue += x.revenue;
      u.orders += r.n;
      unlinked.set(key, u);
    }
  }
  // pedidos (no líneas): un pedido con dos productos cuenta una vez
  for (const o of data.orders) if (inFilter(o.d, o.a, f)) {
    totals.orders += o.n;
    const acc = byAccount.get(o.a);
    if (acc) acc.orders += o.n;
  }
  return {
    totals,
    products: [...byProduct.values()].sort((a, b) => b.profit - a.profit || b.revenue - a.revenue),
    unlinked: [...unlinked.values()].sort((a, b) => b.revenue - a.revenue),
    accounts: [...byAccount.values()].sort((a, b) => b.revenue - a.revenue),
  };
}

/** Totales por día (para los gráficos y los comparativos). */
export function dailyTotals(data: Delivered, products: ProfitProduct[], rates: Map<string, number | null>, account?: string): Map<string, Acc> {
  const index = costIndex(products);
  const out = new Map<string, Acc>();
  const day = (d: string) => {
    let a = out.get(d);
    if (!a) out.set(d, (a = emptyAcc()));
    return a;
  };
  for (const r of data.rows) if (!account || r.a === account) addAcc(day(r.d), rowAcc(r, index.get(`${r.a}|${r.k}`), rates.get(r.a) ?? null));
  for (const o of data.orders) if (!account || o.a === account) day(o.d).orders += o.n;
  return out;
}

export function sumDays(daily: Map<string, Acc>, from: string, to: string): Acc {
  const t = emptyAcc();
  for (const [d, a] of daily) if (d >= from && d <= to) addAcc(t, a);
  return t;
}

// ─── Fechas y períodos ───

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const daysIn = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
/** Primer día del mes `n` meses antes (o después, si n < 0) del de `ymd`. */
export function monthStart(ymd: string, back = 0): string {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - back, 1)).toISOString().slice(0, 10);
}
export const monthEnd = (ymd: string) => `${ymd.slice(0, 7)}-${String(daysIn(ymd.slice(0, 7))).padStart(2, "0")}`;
/** Lunes de la semana de `ymd`. */
export function weekStart(ymd: string): string {
  const dow = (new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(ymd, -dow);
}
const span = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

const fmt = (ymd: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("es-HN", { timeZone: "UTC", ...o }).format(new Date(`${ymd}T12:00:00Z`)).replace(/\./g, "");
export const dayLabel = (ymd: string) => fmt(ymd, { day: "numeric", month: "short" });
export const monthLabel = (ymd: string) => fmt(ymd, { month: "long" });
export const monthShortLabel = (ymd: string) => fmt(ymd, { month: "short" });
export const weekdayLabel = (ymd: string) => fmt(ymd, { weekday: "short" });

/** "24 oct", "1–24 oct", "26 sep – 3 oct". */
export function spanLabel(from: string, to: string): string {
  if (from === to) return dayLabel(from);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8))}–${dayLabel(to)}`;
  return `${dayLabel(from)} – ${dayLabel(to)}`;
}

export const PROFIT_RANGES = [
  { id: "hoy", label: "Hoy" },
  { id: "ayer", label: "Ayer" },
  { id: "semana", label: "Esta semana" },
  { id: "mes", label: "Este mes" },
  { id: "mes-pasado", label: "Mes pasado" },
  { id: "30", label: "30 días" },
] as const;
export type ProfitRangeId = (typeof PROFIT_RANGES)[number]["id"] | "custom";
export const DEFAULT_PROFIT_RANGE: ProfitRangeId = "mes";

export type Period = {
  id: ProfitRangeId;
  /** "Este mes", "Del 1 al 15 oct"… */
  label: string;
  from: string;
  to: string;
  /**
   * Período con el que se compara (el mismo tramo del anterior). `label` va tras "vs. $X"
   * ("en agosto", "ayer (día completo)"); `name`, tras "vs." ("agosto", "ayer").
   */
  prev: { from: string; to: string; label: string; name: string };
};

const MAX_DAYS = 366;

/**
 * Período elegido y su comparación justa: hoy contra ayer, la semana y el mes en curso contra el
 * mismo tramo del anterior (hasta el mismo día), un mes cerrado contra el anterior y un rango propio
 * contra los mismos días justo antes.
 */
export function profitPeriod(id: string | undefined, today: string, custom?: { from?: string; to?: string }): Period {
  const ymd = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s ? s : null);
  if (id === "custom" || (!id && (custom?.from || custom?.to))) {
    let f = ymd(custom?.from);
    let t = ymd(custom?.to);
    if (f || t) {
      t = t ?? today;
      f = f ?? t;
      if (f > t) [f, t] = [t, f];
      if (t > today) t = today;
      if (f > t) f = t;
      if (span(f, t) + 1 > MAX_DAYS) f = addDays(t, -(MAX_DAYS - 1));
      const n = span(f, t) + 1;
      const pf = addDays(f, -n);
      const pt = addDays(f, -1);
      return { id: "custom", label: spanLabel(f, t), from: f, to: t, prev: { from: pf, to: pt, label: `del ${spanLabel(pf, pt)}`, name: spanLabel(pf, pt) } };
    }
  }
  switch (id) {
    case "hoy":
      return { id, label: "Hoy", from: today, to: today, prev: { from: addDays(today, -1), to: addDays(today, -1), label: "ayer (día completo)", name: "ayer" } };
    case "ayer": {
      const y = addDays(today, -1);
      return { id, label: "Ayer", from: y, to: y, prev: { from: addDays(y, -1), to: addDays(y, -1), label: "anteayer", name: "anteayer" } };
    }
    case "semana": {
      const w = weekStart(today);
      const pf = addDays(w, -7);
      const pt = addDays(today, -7);
      return { id, label: "Esta semana", from: w, to: today, prev: { from: pf, to: pt, label: `la semana pasada a esta altura (${spanLabel(pf, pt)})`, name: "la semana pasada" } };
    }
    case "mes-pasado": {
      const f = monthStart(today, 1);
      const pf = monthStart(today, 2);
      return { id, label: capitalize(monthLabel(f)), from: f, to: monthEnd(f), prev: { from: pf, to: monthEnd(pf), label: `en ${monthLabel(pf)}`, name: monthLabel(pf) } };
    }
    case "30": {
      const f = addDays(today, -29);
      return { id, label: "Últimos 30 días", from: f, to: today, prev: { from: addDays(f, -30), to: addDays(f, -1), label: "en los 30 días anteriores", name: "los 30 días anteriores" } };
    }
    default: {
      const f = monthStart(today);
      const pf = monthStart(today, 1);
      const pt = `${pf.slice(0, 8)}${String(Math.min(Number(today.slice(8)), daysIn(pf.slice(0, 7)))).padStart(2, "0")}`;
      return { id: "mes", label: "Este mes", from: f, to: today, prev: { from: pf, to: pt, label: `en ${monthLabel(pf)} al mismo día (${spanLabel(pf, pt)})`, name: `${monthLabel(pf)} al mismo día` } };
    }
  }
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const pctChange = (cur: number, prev: number): number | null => (prev > 0 ? (cur - prev) / prev : prev < 0 ? (cur - prev) / Math.abs(prev) : null);

export type Bucket = { k: number; key: string; from: string; to: string; acc: Acc };

/** Últimos `n` meses (k = 0, el mes en curso hasta hoy) y lo que llevaba el mes pasado a esta altura. */
export function monthBuckets(daily: Map<string, Acc>, today: string, n = 6) {
  const buckets: Bucket[] = [];
  for (let k = n - 1; k >= 0; k--) {
    const f = monthStart(today, k);
    const t = k === 0 ? today : monthEnd(f);
    buckets.push({ k, key: f.slice(0, 7), from: f, to: t, acc: sumDays(daily, f, t) });
  }
  const pf = monthStart(today, 1);
  const pt = `${pf.slice(0, 8)}${String(Math.min(Number(today.slice(8)), daysIn(pf.slice(0, 7)))).padStart(2, "0")}`;
  const elapsed = Number(today.slice(8));
  const days = daysIn(today.slice(0, 7));
  return { buckets, prevToDate: sumDays(daily, pf, pt), prevTo: pt, elapsed, days };
}

/** Últimas `n` semanas de lunes a domingo (k = 0, la de hoy) y lo que llevaba la pasada a esta altura. */
export function weekBuckets(daily: Map<string, Acc>, today: string, n = 12) {
  const w0 = weekStart(today);
  const buckets: Bucket[] = [];
  for (let k = n - 1; k >= 0; k--) {
    const f = addDays(w0, -7 * k);
    const t = k === 0 ? today : addDays(f, 6);
    buckets.push({ k, key: f, from: f, to: t, acc: sumDays(daily, f, t) });
  }
  const pt = addDays(today, -7);
  return { buckets, prevToDate: sumDays(daily, addDays(w0, -7), pt), prevTo: pt };
}

/** Días del período (para el gráfico diario), con los vacíos en cero. */
export function dayBuckets(daily: Map<string, Acc>, from: string, to: string): Bucket[] {
  const out: Bucket[] = [];
  for (let d = from, k = span(from, to); d <= to; d = addDays(d, 1), k--) out.push({ k, key: d, from: d, to: d, acc: daily.get(d) ?? emptyAcc() });
  return out;
}

/** Proyección del mes a este ritmo (desde el día 7, para que no se dispare con pocos días). */
export function monthProjection(cur: number, elapsed: number, days: number): number | null {
  return elapsed >= 7 ? (cur / elapsed) * days : null;
}

/** Desde qué día hay que leer lo entregado para el período, su comparación y los gráficos. */
export function windowStart(today: string, period: Period, months = 6): string {
  const m = monthStart(today, months - 1);
  const w = addDays(weekStart(today), -7 * 11);
  return [m, w, period.prev.from].sort()[0];
}
