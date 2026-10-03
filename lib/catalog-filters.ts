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

export type CatalogFilters = {
  q: string;
  tab: CatalogTab;
  /** Moneda del proveedor (CRC, HNL…): en Drop equivale al país del que vende. */
  country?: string;
  vendor?: string;
  price?: PriceBand;
  change?: ChangeKind;
  sort?: CatalogSort;
};

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
  const tab = one("f") ?? "";
  const country = one("pais");
  const price = one("precio");
  const change = one("cambio");
  const sort = one("sort");
  return {
    q: one("q") ?? "",
    tab: CAT_TABS.some((t) => t.id === tab) ? (tab as CatalogTab) : "",
    country: country && /^[A-Z]{3}$/.test(country) ? country : undefined,
    vendor: one("prov"),
    price: price && price in PRICE_BANDS ? (price as PriceBand) : undefined,
    change: change && change in CHANGE_KINDS ? (change as ChangeKind) : undefined,
    sort: sort && sort in CAT_SORTS ? (sort as CatalogSort) : undefined,
  };
}

/** Query string con los filtros actuales + cambios (vacíos se omiten). */
export function catalogQuery(f: CatalogFilters, patch: Record<string, string | undefined> = {}): string {
  const merged: Record<string, string | undefined> = {
    q: f.q, f: f.tab, pais: f.country, prov: f.vendor, precio: f.price, cambio: f.change, sort: f.sort, ...patch,
  };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
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

type FacetKey = "tab" | "country" | "vendor" | "price" | "change";

/** ¿Pasa los filtros? `skip` deja fuera una faceta (para contar sus opciones). */
function passes(m: CatalogMovement, f: CatalogFilters, ctx: CatalogContext, q: string, skip?: FacetKey): boolean {
  if (q && ![m.name, m.vendor, m.id].some((v) => v && fold(v).includes(q))) return false;
  if (skip !== "tab" && !inCatalogTab(m, f.tab)) return false;
  if (skip !== "country" && f.country && m.currency !== f.country) return false;
  if (skip !== "vendor" && f.vendor && (m.vendor ?? "") !== f.vendor) return false;
  if (skip !== "price" && f.price && priceBand(m, ctx) !== f.price) return false;
  if (skip !== "change" && f.change && !(m.id && ctx.changes.get(m.id)?.has(f.change))) return false;
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

  const countryPool = pool("country");
  const byCountry = tally(countryPool, (m) => m.currency);
  const countries: Facet = {
    all: countryPool.length,
    options: [...byCountry]
      .sort((a, b) => b[1] - a[1])
      .map(([cur, count]) => ({ value: cur, label: countryOfCurrency(cur), count })),
  };

  // proveedores: los que tienen algo con los filtros actuales (y el elegido, aunque quede en 0)
  const vendorPool = pool("vendor");
  const byVendor = tally(vendorPool, (m) => m.vendor);
  if (f.vendor && !byVendor.has(f.vendor)) byVendor.set(f.vendor, 0);
  const vendors: Facet = {
    all: vendorPool.length,
    options: [...byVendor]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"))
      .map(([v, count]) => ({ value: v, label: v, count })),
  };

  // con una sola moneda a la vista, cada tercio dice su rango de precio
  const pricePool = pool("price");
  const byBand = tally(pricePool, (m) => priceBand(m, ctx));
  const curs = new Set(pricePool.map((m) => m.currency));
  const only = curs.size === 1 ? [...curs][0] : f.country;
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

  return { tabs, countries, vendors, prices, changes };
}
