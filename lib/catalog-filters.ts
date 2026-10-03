import { changeTags, type CatalogChange, type CatalogMovement } from "./catalog.ts";
import { COUNTRIES } from "./countries.ts";
import { fmtMoney } from "./format.ts";

// Filtros y orden del catálogo de la competencia (en memoria: el catálogo completo ya viene
// cargado). Los conteos son por faceta: cada opción cuenta con los demás filtros aplicados,
// así el número que se ve junto a la opción es exactamente lo que aparece al elegirla.

export const CAT_LOW_STOCK = 10;

export const CAT_TABS = [
  { id: "", label: "Todos" },
  { id: "moving", label: "En movimiento" },
  { id: "restock", label: "Reabastecidos" },
  { id: "low", label: "Stock bajo" },
  { id: "out", label: "Agotados" },
  { id: "still", label: "Sin movimiento" },
] as const;
export type CatalogTab = (typeof CAT_TABS)[number]["id"];

/** Sin `sort`, lo que más se mueve primero. */
export const CAT_DEFAULT_SORT = "Más movimiento";
export const CAT_SORTS = {
  recent: "Movimiento más reciente",
  restock: "Más reabastecidos",
  cost_asc: "Precio proveedor: menor a mayor",
  cost_desc: "Precio proveedor: mayor a menor",
  stock_desc: "Stock: mayor a menor",
  stock_asc: "Stock: menor a mayor",
  name_asc: "Nombre: A → Z",
} as const;
export type CatalogSort = keyof typeof CAT_SORTS;

/** Rangos de stock actual (unidades: no dependen de la moneda). */
export const STOCK_BANDS = [
  { id: "0", label: "Agotados · 0 u.", min: 0, max: 0 },
  { id: "1-10", label: "1 – 10 u.", min: 1, max: 10 },
  { id: "11-50", label: "11 – 50 u.", min: 11, max: 50 },
  { id: "51-200", label: "51 – 200 u.", min: 51, max: 200 },
  { id: "201-1000", label: "201 – 1,000 u.", min: 201, max: 1000 },
  { id: "mas-1000", label: "Más de 1,000 u.", min: 1001, max: Infinity },
] as const;
export type StockBand = (typeof STOCK_BANDS)[number]["id"];

/** Tercios del precio proveedor, calculados dentro de cada moneda. */
export const PRICE_BANDS = { low: "Más baratos", mid: "Precio medio", high: "Más caros" } as const;
export type PriceBand = keyof typeof PRICE_BANDS;

/** Cambios detectados entre sincronizaciones (ventana de la página: 30 días). */
export const CHANGE_KINDS = {
  cost_down: "Bajó el costo",
  cost_up: "Subió el costo",
  stockout: "Se agotó",
  restock: "Volvió a tener stock",
} as const;
export type ChangeKind = keyof typeof CHANGE_KINDS;

/** Los filtros de lista son de selección múltiple: dentro de uno se suman, entre ellos se cruzan. */
export type CatalogFilters = {
  q: string;
  tab: CatalogTab;
  /** Monedas del proveedor (CRC, HNL…): en Drop equivale al país del que vende. */
  countries: string[];
  vendors: string[];
  stocks: StockBand[];
  /** Rango exacto de stock escrito a mano (unidades, ambos incluidos). */
  stockMin?: number;
  stockMax?: number;
  prices: PriceBand[];
  changes: ChangeKind[];
  sort?: CatalogSort;
};
export type QueryPatch = Record<string, string | string[] | undefined>;

export type FacetOption = { value: string; label: string; count: number };
/** `all`: cuántos quedan sin este filtro (con los demás aplicados). */
export type Facet = { all: number; options: FacetOption[] };

/** Datos derivados que usan los filtros: tipos de cambio por código y cortes de precio por moneda. */
export type CatalogContext = { changes: Map<string, Set<ChangeKind>>; cuts: Map<string, [number, number]> };

export function parseCatalogFilters(sp: Record<string, string | string[] | undefined>): CatalogFilters {
  const one = (k: string) => {
    const v = sp[k];
    const s = (Array.isArray(v) ? v[0] : v)?.trim();
    return s ? s : undefined;
  };
  // varios valores del mismo filtro llegan repetidos: ?prov=A&prov=B
  const many = (k: string) => {
    const v = sp[k];
    const list = (Array.isArray(v) ? v : v ? [v] : []).map((s) => s.trim()).filter(Boolean);
    return [...new Set(list)];
  };
  // enteros ≥ 0 (acepta "1,000"); lo demás se ignora
  const units = (k: string) => {
    const s = one(k)?.replace(/[,\s]/g, "");
    return s && /^\d+$/.test(s) ? Number(s) : undefined;
  };
  const tab = one("f") ?? "";
  const sort = one("sort");
  let stockMin = units("smin");
  let stockMax = units("smax");
  if (stockMin !== undefined && stockMax !== undefined && stockMin > stockMax) [stockMin, stockMax] = [stockMax, stockMin];
  return {
    q: one("q") ?? "",
    tab: CAT_TABS.some((t) => t.id === tab) ? (tab as CatalogTab) : "",
    countries: many("pais").filter((c) => /^[A-Z]{3}$/.test(c)),
    vendors: many("prov"),
    stocks: many("stock").filter((s): s is StockBand => STOCK_BANDS.some((b) => b.id === s)),
    stockMin,
    stockMax,
    prices: many("precio").filter((p): p is PriceBand => p in PRICE_BANDS),
    changes: many("cambio").filter((c): c is ChangeKind => c in CHANGE_KINDS),
    sort: sort && sort in CAT_SORTS ? (sort as CatalogSort) : undefined,
  };
}

/** Query string con los filtros actuales + cambios (vacíos se omiten; las listas van repetidas). */
export function catalogQuery(f: CatalogFilters, patch: QueryPatch = {}): string {
  const merged: QueryPatch = {
    q: f.q, f: f.tab, pais: f.countries, prov: f.vendors, stock: f.stocks,
    smin: f.stockMin?.toString(), smax: f.stockMax?.toString(), precio: f.prices, cambio: f.changes, sort: f.sort,
    ...patch,
  };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) for (const x of Array.isArray(v) ? v : [v]) if (x) p.append(k, x);
  return p.toString();
}

/** Nombre del país de una moneda; si la comparten varios (USD) o no se conoce, la moneda. */
export function countryOfCurrency(currency: string): string {
  const hits = COUNTRIES.filter((c) => c.currency === currency);
  return hits.length === 1 ? hits[0].name : currency;
}

/** Valor en el percentil `p` (rango más cercano) de una lista ordenada. */
const cutAt = (sorted: number[], p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];

export function catalogContext(items: CatalogMovement[], changes: CatalogChange[]): CatalogContext {
  const byCode = new Map<string, Set<ChangeKind>>();
  for (const c of changes) {
    if (!c.code) continue;
    for (const t of changeTags(c)) {
      if (!(t.kind in CHANGE_KINDS)) continue;
      const set = byCode.get(c.code) ?? new Set<ChangeKind>();
      set.add(t.kind as ChangeKind);
      byCode.set(c.code, set);
    }
  }
  const costs = new Map<string, number[]>();
  for (const m of items) {
    if (m.cost === null) continue;
    const list = costs.get(m.currency) ?? [];
    list.push(m.cost);
    costs.set(m.currency, list);
  }
  const cuts = new Map<string, [number, number]>();
  for (const [cur, list] of costs) {
    list.sort((a, b) => a - b);
    cuts.set(cur, [cutAt(list, 1 / 3), cutAt(list, 2 / 3)]);
  }
  return { changes: byCode, cuts };
}

export function priceBand(m: CatalogMovement, ctx: CatalogContext): PriceBand | null {
  const cut = ctx.cuts.get(m.currency);
  if (m.cost === null || !cut) return null;
  return m.cost <= cut[0] ? "low" : m.cost <= cut[1] ? "mid" : "high";
}

export function stockBand(m: CatalogMovement): StockBand | null {
  const s = m.stock;
  if (s === null) return null;
  return STOCK_BANDS.find((b) => s >= b.min && s <= b.max)?.id ?? null;
}

export function inCatalogTab(m: CatalogMovement, tab: CatalogTab): boolean {
  switch (tab) {
    case "moving": return m.unitsDown > 0;
    case "restock": return m.unitsUp > 0;
    case "low": return m.stock !== null && m.stock > 0 && m.stock <= CAT_LOW_STOCK;
    case "out": return m.stock === 0; // igual que "Agotados" del resumen
    case "still": return m.unitsDown === 0 && m.unitsUp === 0;
    default: return true;
  }
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** ¿Está dentro del rango escrito a mano? Sin rango, todo pasa; con rango, el stock sin dato no. */
export function inStockRange(m: CatalogMovement, min?: number, max?: number): boolean {
  if (min === undefined && max === undefined) return true;
  if (m.stock === null) return false;
  return (min === undefined || m.stock >= min) && (max === undefined || m.stock <= max);
}

// el rango escrito es su propio filtro: los conteos de los rangos fijos ya lo respetan
type FacetKey = "tab" | "country" | "vendor" | "stock" | "range" | "price" | "change";

/** ¿Pasa los filtros? `skip` deja fuera una faceta (para contar sus opciones). */
function passes(m: CatalogMovement, f: CatalogFilters, ctx: CatalogContext, q: string, skip?: FacetKey): boolean {
  if (q && ![m.name, m.vendor, m.id].some((v) => v && fold(v).includes(q))) return false;
  if (skip !== "tab" && !inCatalogTab(m, f.tab)) return false;
  if (skip !== "country" && f.countries.length && !f.countries.includes(m.currency)) return false;
  if (skip !== "vendor" && f.vendors.length && !f.vendors.includes(m.vendor ?? "")) return false;
  if (skip !== "stock" && f.stocks.length) {
    const b = stockBand(m);
    if (!b || !f.stocks.includes(b)) return false;
  }
  if (skip !== "range" && !inStockRange(m, f.stockMin, f.stockMax)) return false;
  if (skip !== "price" && f.prices.length) {
    const b = priceBand(m, ctx);
    if (!b || !f.prices.includes(b)) return false;
  }
  if (skip !== "change" && f.changes.length) {
    const kinds = m.id ? ctx.changes.get(m.id) : undefined;
    if (!kinds || !f.changes.some((k) => kinds.has(k))) return false;
  }
  return true;
}

export function sortCatalog(rows: CatalogMovement[], sort?: CatalogSort): CatalogMovement[] {
  const byName = (a: CatalogMovement, b: CatalogMovement) => a.name.localeCompare(b.name, "es");
  const byMoving = (a: CatalogMovement, b: CatalogMovement) =>
    b.unitsDown - a.unitsDown || b.stockChanges - a.stockChanges || byName(a, b);
  // sin dato, al final (en cualquier dirección)
  const nullsLast = (x: number | string | null, y: number | string | null, cmp: () => number) =>
    x === null ? (y === null ? 0 : 1) : y === null ? -1 : cmp();
  const cmp = (a: CatalogMovement, b: CatalogMovement): number => {
    switch (sort) {
      case "recent":
        return nullsLast(a.lastMove, b.lastMove, () => b.lastMove!.localeCompare(a.lastMove!)) || byMoving(a, b);
      case "restock":
        return b.unitsUp - a.unitsUp || byName(a, b);
      case "cost_asc":
      case "cost_desc": {
        // monedas distintas no se comparan: primero se agrupan por moneda
        const dir = sort === "cost_asc" ? 1 : -1;
        return a.currency.localeCompare(b.currency) || nullsLast(a.cost, b.cost, () => (a.cost! - b.cost!) * dir) || byName(a, b);
      }
      case "stock_desc":
      case "stock_asc": {
        const dir = sort === "stock_asc" ? 1 : -1;
        return nullsLast(a.stock, b.stock, () => (a.stock! - b.stock!) * dir) || byName(a, b);
      }
      case "name_asc":
        return byName(a, b);
      default:
        return byMoving(a, b);
    }
  };
  return [...rows].sort(cmp);
}

/** Tarjetas finales: búsqueda, pestaña, filtros y orden. */
export function applyCatalogFilters(items: CatalogMovement[], f: CatalogFilters, ctx: CatalogContext): CatalogMovement[] {
  const q = fold(f.q.trim());
  return sortCatalog(items.filter((m) => passes(m, f, ctx, q)), f.sort);
}

export type CatalogFacets = {
  tabs: Record<string, number>;
  countries: Facet;
  vendors: Facet;
  stocks: Facet;
  prices: Facet;
  changes: Facet;
};

/** Conteo de cada opción de cada filtro, con los demás filtros aplicados. */
export function catalogFacets(items: CatalogMovement[], f: CatalogFilters, ctx: CatalogContext): CatalogFacets {
  const q = fold(f.q.trim());
  const pool = (skip: FacetKey) => items.filter((m) => passes(m, f, ctx, q, skip));
  const tally = (rows: CatalogMovement[], key: (m: CatalogMovement) => string | null) => {
    const n = new Map<string, number>();
    for (const m of rows) {
      const k = key(m);
      if (k) n.set(k, (n.get(k) ?? 0) + 1);
    }
    return n;
  };

  const tabPool = pool("tab");
  const tabs = Object.fromEntries(CAT_TABS.map((t) => [t.id, tabPool.filter((m) => inCatalogTab(m, t.id)).length]));

  // lo elegido sigue en la lista aunque con los demás filtros quede en 0
  const keep = (n: Map<string, number>, chosen: string[]) => {
    for (const v of chosen) if (!n.has(v)) n.set(v, 0);
    return n;
  };

  const countryPool = pool("country");
  const byCountry = keep(tally(countryPool, (m) => m.currency), f.countries);
  const countries: Facet = {
    all: countryPool.length,
    options: [...byCountry]
      .sort((a, b) => b[1] - a[1])
      .map(([cur, count]) => ({ value: cur, label: countryOfCurrency(cur), count })),
  };

  // proveedores: los que tienen algo con los filtros actuales
  const vendorPool = pool("vendor");
  const byVendor = keep(tally(vendorPool, (m) => m.vendor), f.vendors);
  const vendors: Facet = {
    all: vendorPool.length,
    options: [...byVendor]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"))
      .map(([v, count]) => ({ value: v, label: v, count })),
  };

  const stockPool = pool("stock");
  const byStock = tally(stockPool, stockBand);
  const stocks: Facet = {
    all: stockPool.length,
    options: STOCK_BANDS.map((b) => ({ value: b.id, label: b.label, count: byStock.get(b.id) ?? 0 })),
  };

  // con una sola moneda a la vista, cada tercio dice su rango de precio
  const pricePool = pool("price");
  const byBand = tally(pricePool, (m) => priceBand(m, ctx));
  const curs = new Set(pricePool.map((m) => m.currency));
  const only = curs.size === 1 ? [...curs][0] : f.countries.length === 1 ? f.countries[0] : undefined;
  const cut = only ? ctx.cuts.get(only) : undefined;
  const range: Record<PriceBand, string> | null = cut && only
    ? {
        low: `hasta ${fmtMoney(cut[0], only)}`,
        mid: `${fmtMoney(cut[0], only)} – ${fmtMoney(cut[1], only)}`,
        high: `más de ${fmtMoney(cut[1], only)}`,
      }
    : null;
  const prices: Facet = {
    all: pricePool.length,
    options: (Object.keys(PRICE_BANDS) as PriceBand[]).map((b) => ({
      value: b,
      label: range ? `${PRICE_BANDS[b]} · ${range[b]}` : PRICE_BANDS[b],
      count: byBand.get(b) ?? 0,
    })),
  };

  const changePool = pool("change");
  const changes: Facet = {
    all: changePool.length,
    options: (Object.keys(CHANGE_KINDS) as ChangeKind[]).map((k) => ({
      value: k,
      label: CHANGE_KINDS[k],
      count: changePool.filter((m) => m.id && ctx.changes.get(m.id)?.has(k)).length,
    })),
  };

  return { tabs, countries, vendors, stocks, prices, changes };
}
