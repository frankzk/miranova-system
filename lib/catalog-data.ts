import "server-only";
import { db } from "./supabase";
import type { CatalogChange, CatalogMovement, CatalogProduct } from "./catalog";

/** Cuentas de dropshipper marcadas como fuente del catálogo de la competencia. */
export async function catalogAccounts(): Promise<
  { id: string; name: string; currency: string; catalog_sync_at: string | null; catalog_sync_msg: string | null }[]
> {
  const { data, error } = await db()
    .from("accounts")
    .select("id, name, currency, catalog_sync_at, catalog_sync_msg")
    .eq("catalog_only", true)
    .order("name");
  if (error) throw error;
  return data;
}

/** Lee el catálogo de la competencia (hasta `limit` filas) como CatalogProduct para analizar. */
export async function listCatalog(accountId: string | null, limit = 8000): Promise<CatalogProduct[]> {
  const pageSize = 1000;
  const out: CatalogProduct[] = [];
  for (let from = 0; from < limit; from += pageSize) {
    let q = db()
      .from("catalog_products")
      .select("code, external_id, name, vendor, cost, suggested, stock, currency, image_url")
      .order("name")
      .range(from, Math.min(from + pageSize, limit) - 1);
    if (accountId) q = q.eq("account_id", accountId);
    const { data, error } = await q;
    if (error) throw error;
    for (const r of data) {
      out.push({
        id: (r.code as string | null) ?? (r.external_id as string),
        name: r.name as string,
        vendor: (r.vendor as string | null) ?? null,
        stock: r.stock === null ? null : Number(r.stock),
        cost: r.cost === null ? null : Number(r.cost),
        suggested: r.suggested === null ? null : Number(r.suggested),
        currency: (r.currency as string | null) ?? "CRC",
        image: (r.image_url as string | null) ?? null,
      });
    }
    if (data.length < pageSize) break;
  }
  return out;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** Catálogo con el movimiento de stock de los últimos `days` días (lo más movido primero). */
export async function listCatalogMovement(accountId: string | null, days = 30): Promise<CatalogMovement[]> {
  const { data, error } = await db().rpc("catalog_movement", { p_account: accountId, p_days: days });
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: text(r.code),
    name: text(r.name) ?? "Producto",
    vendor: text(r.vendor),
    stock: num(r.stock),
    cost: num(r.cost),
    suggested: num(r.suggested),
    currency: text(r.currency) ?? "CRC",
    image: text(r.image_url),
    unitsDown: num(r.units_down) ?? 0,
    unitsUp: num(r.units_up) ?? 0,
    stockChanges: num(r.stock_changes) ?? 0,
    lastMove: text(r.last_move),
  }));
}

/** Serie de stock por código de producto (solo los que tienen 2+ fotos) para la mini-gráfica. */
export async function listCatalogSeries(accountId: string | null, days = 30): Promise<Map<string, number[]>> {
  const { data, error } = await db().rpc("catalog_stock_series", { p_account: accountId, p_days: days });
  if (error) throw error;
  const obj = (data ?? {}) as Record<string, unknown>;
  const map = new Map<string, number[]>();
  for (const [code, arr] of Object.entries(obj)) {
    if (Array.isArray(arr)) map.set(code, arr.map((x) => Number(x)).filter((x) => Number.isFinite(x)));
  }
  return map;
}

/** Cambios de precio/stock del catálogo en los últimos `days` días (más recientes primero). */
export async function listCatalogChanges(accountId: string | null, days = 30): Promise<CatalogChange[]> {
  const { data, error } = await db().rpc("catalog_changes", { p_account: accountId, p_days: days });
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.map((r) => ({
    name: text(r.name) ?? "Producto",
    vendor: text(r.vendor),
    code: text(r.code),
    currency: text(r.currency) ?? "CRC",
    takenAt: text(r.taken_at) ?? "",
    prevCost: num(r.prev_cost),
    cost: num(r.cost),
    prevSuggested: num(r.prev_suggested),
    suggested: num(r.suggested),
    prevStock: num(r.prev_stock),
    stock: num(r.stock),
  }));
}
