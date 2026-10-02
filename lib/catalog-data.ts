import "server-only";
import { db } from "./supabase";
import type { CatalogProduct } from "./catalog";

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
