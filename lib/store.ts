import "server-only";
import { db } from "./supabase";
import { extractOrders, normalizeOrder, type NormalizedOrder, type NormalizeOptions } from "./normalize";

export type AccountCtx = { id: string; currency: string; timezone: string; geo?: Record<string, string> | null };

/** Guarda (o actualiza) pedidos de una cuenta y reemplaza sus líneas de producto. */
export async function saveOrders(accountId: string, orders: NormalizedOrder[]): Promise<number> {
  if (orders.length === 0) return 0;
  const now = new Date().toISOString();

  const rows = orders.map(({ items: _items, ...o }) => ({ ...o, account_id: accountId, updated_at: now }));
  const { data, error } = await db()
    .from("orders")
    .upsert(rows, { onConflict: "account_id,external_id" })
    .select("id, external_id");
  if (error) throw error;

  const idByExternal = new Map(data.map((r) => [r.external_id as string, r.id as string]));

  // Solo reemplazamos las líneas cuando la respuesta traía productos:
  // un listado sin detalle no debe borrar los productos ya capturados.
  const withItems = orders.filter((o) => o.items.length > 0);
  if (withItems.length > 0) {
    const ids = withItems.map((o) => idByExternal.get(o.external_id)!).filter(Boolean);
    const del = await db().from("order_items").delete().in("order_id", ids);
    if (del.error) throw del.error;
    const itemRows = withItems.flatMap((o) =>
      o.items.map((it, position) => ({ ...it, position, order_id: idByExternal.get(o.external_id)! })),
    );
    const ins = await db().from("order_items").insert(itemRows);
    if (ins.error) throw ins.error;
  }
  return orders.length;
}

/**
 * Un listado puede traer menos campos que el detalle. Para no perder datos,
 * un campo vacío en la respuesta nueva no sobreescribe uno lleno en la base.
 */
async function mergeWithExisting(accountId: string, orders: NormalizedOrder[]): Promise<NormalizedOrder[]> {
  if (orders.length === 0) return orders;
  const { data, error } = await db()
    .from("orders")
    .select("*")
    .eq("account_id", accountId)
    .in("external_id", orders.map((o) => o.external_id));
  if (error) throw error;
  const existing = new Map(data.map((r) => [r.external_id as string, r]));

  return orders.map((o) => {
    const prev = existing.get(o.external_id);
    if (!prev) return o;
    const merged: Record<string, unknown> = { ...o };
    for (const [k, v] of Object.entries(o)) {
      if ((v === null || v === undefined) && prev[k] !== null && prev[k] !== undefined) merged[k] = prev[k];
    }
    merged.raw = typeof prev.raw === "object" && typeof o.raw === "object"
      ? { ...(prev.raw as object), ...(o.raw as object) }
      : o.raw;
    return merged as NormalizedOrder;
  });
}

const opts = (a: AccountCtx): NormalizeOptions => ({ currency: a.currency, timezone: a.timezone, geo: a.geo });

/** Procesa una respuesta de la plataforma y devuelve cuántos pedidos traía. */
export async function ingestPayload(
  payload: unknown,
  source: "extension" | "sync",
  sourceUrl: string | null,
  account: AccountCtx,
): Promise<number> {
  const orders = await mergeWithExisting(account.id, extractOrders(payload, opts(account)));
  const saved = await saveOrders(account.id, orders);

  const log = await db().from("ingest_log").insert({
    source,
    source_url: sourceUrl,
    orders_found: saved,
    payload,
    account_id: account.id,
  });
  if (log.error) console.error("ingest_log", log.error);
  return saved;
}

/** Vuelve a normalizar todos los pedidos desde su `raw` (tras ajustar el mapeo). */
export async function reprocessAll(): Promise<number> {
  const { data: rows, error: accErr } = await db().from("accounts").select("id, currency, timezone, geo");
  if (accErr) throw accErr;
  const accounts: AccountCtx[] = rows.map((r) => ({ ...r, geo: r.geo?.map ?? null }));

  let total = 0;
  const pageSize = 500;
  for (const account of accounts) {
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db()
        .from("orders")
        .select("external_id, raw")
        .eq("account_id", account.id)
        .order("external_id")
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const orders = data.flatMap((r) => {
        const o = normalizeOrder(r.raw, opts(account));
        return o ? [{ ...o, external_id: r.external_id as string }] : [];
      });
      total += await saveOrders(account.id, orders);
      if (data.length < pageSize) break;
    }
  }
  return total;
}

/** Guarda (o actualiza) el catálogo de productos de una cuenta. */
export async function saveProducts(
  accountId: string,
  currency: string,
  products: import("./products").NormalizedProduct[],
): Promise<number> {
  if (products.length === 0) return 0;
  const now = new Date().toISOString();
  const rows = products.map((p) => ({ ...p, account_id: accountId, currency, updated_at: now }));
  const { error } = await db().from("products").upsert(rows, { onConflict: "account_id,external_id" });
  if (error) throw error;
  return products.length;
}
