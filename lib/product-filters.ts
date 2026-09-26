import type { Product } from "./queries";

// Filtros y orden del catálogo (en memoria: el catálogo completo ya viene cargado).
// Los usa la página de Productos y su exportación CSV, para que coincidan.

export const LOW_STOCK = 10;
export const SALES_DAYS = 30;

export const TABS = [
  { id: "", label: "Todos" },
  { id: "active", label: "Activos" },
  { id: "low", label: "Stock bajo" },
  { id: "out", label: "Sin stock" },
  { id: "inactive", label: "Inactivos" },
] as const;

export const PRODUCT_SORTS = {
  name_asc: "Nombre: A → Z",
  name_desc: "Nombre: Z → A",
  price_desc: "Precio: mayor a menor",
  price_asc: "Precio: menor a mayor",
  stock_desc: "Inventario: mayor a menor",
  stock_asc: "Inventario: menor a mayor",
  sold_desc: "Más vendidos",
  sold_asc: "Menos vendidos",
} as const;
export type ProductSort = keyof typeof PRODUCT_SORTS;

export const VARIANTS = { con: "Con variantes", sin: "Sin variantes" } as const;

export type ProductFilters = { q: string; tab: string; status?: string; variants?: keyof typeof VARIANTS; sort?: ProductSort };
export type Sales = Record<string, { units: number; orders: number }>;

export function parseProductFilters(sp: Record<string, string | string[] | undefined>): ProductFilters {
  const one = (k: string) => {
    const v = sp[k];
    const s = (Array.isArray(v) ? v[0] : v)?.trim();
    return s ? s : undefined;
  };
  const tab = one("f") ?? "";
  const variants = one("var");
  const sort = one("sort");
  return {
    q: one("q") ?? "",
    tab: TABS.some((t) => t.id === tab) ? tab : "",
    status: one("status"),
    variants: variants && variants in VARIANTS ? (variants as keyof typeof VARIANTS) : undefined,
    sort: sort && sort in PRODUCT_SORTS ? (sort as ProductSort) : undefined,
  };
}

export const isActive = (p: Product) => !p.status || (/activ/i.test(p.status) && !/inactiv/i.test(p.status));

export function inTab(p: Product, tab: string) {
  if (tab === "active") return isActive(p);
  if (tab === "inactive") return !isActive(p);
  if (tab === "out") return (p.stock ?? 0) <= 0;
  if (tab === "low") return p.stock !== null && p.stock > 0 && p.stock <= LOW_STOCK;
  return true;
}

/** Ventas del producto: primero por su ID (no cambia si se renombra), luego por SKU o nombre. */
export const soldOf = (p: Product, sales: Sales) =>
  sales[`${p.account_id}:id:${p.external_id}`] ?? sales[`${p.account_id}:${p.sku ?? ""}`] ?? sales[`${p.account_id}:${p.name}`];

/** Búsqueda + estado exacto + variantes (sin la pestaña): base de los conteos de las pestañas. */
export function refine(all: Product[], f: ProductFilters): Product[] {
  const q = f.q.toLowerCase();
  return all.filter(
    (p) =>
      (!q || [p.name, p.sku, p.code].some((v) => v?.toLowerCase().includes(q))) &&
      (!f.status || (p.status ?? "") === f.status) &&
      (!f.variants || (f.variants === "con" ? p.variants_count > 0 : p.variants_count === 0)),
  );
}

export function sortProducts(rows: Product[], sort: ProductSort | undefined, sales: Sales): Product[] {
  if (!sort) return rows;
  const [key, dir] = sort.split("_") as [string, "asc" | "desc"];
  const val = (p: Product): number | string | null =>
    key === "name" ? p.name.toLowerCase() : key === "price" ? p.price : key === "stock" ? p.stock : soldOf(p, sales)?.units ?? 0;
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x === null) return y === null ? 0 : 1; // sin dato, al final
    if (y === null) return -1;
    return (typeof x === "string" ? x.localeCompare(y as string, "es") : x - (y as number)) * sign;
  });
}

/** Filas finales: búsqueda, estado, variantes, pestaña y orden. */
export function applyProductFilters(all: Product[], f: ProductFilters, sales: Sales): Product[] {
  return sortProducts(refine(all, f).filter((p) => inTab(p, f.tab)), f.sort, sales);
}

/** Query string con los filtros actuales + cambios (vacíos se omiten). */
export function productQuery(f: ProductFilters, patch: Record<string, string | undefined> = {}): string {
  const merged: Record<string, string | undefined> = { q: f.q, f: f.tab, status: f.status, var: f.variants, sort: f.sort, ...patch };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
  return p.toString();
}
