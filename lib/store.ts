import "server-only";
import { db } from "./supabase";
import { extractOrders, normalizeOrder, type NormalizedOrder } from "./normalize";

/** Guarda (o actualiza) pedidos y reemplaza sus líneas de producto. */
export async function saveOrders(orders: NormalizedOrder[]): Promise<number> {
  if (orders.length === 0) return 0;
  const now = new Date().toISOString();

  const rows = orders.map(({ items: _items, ...o }) => ({ ...o, updated_at: now }));
  const { data, error } = await db()
    .from("orders")
    .upsert(rows, { onConflict: "external_id" })
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
 * Un listado de Drop puede traer menos campos que el detalle. Para no perder
 * datos, mezclamos lo nuevo sobre lo que ya había: un campo vacío en la
 * respuesta nueva no sobreescribe uno lleno en la base.
 */
async function mergeWithExisting(orders: NormalizedOrder[]): Promise<NormalizedOrder[]> {
  if (orders.length === 0) return orders;
  const { data, error } = await db()
    .from("orders")
    .select("*")
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
    // conservar el raw más completo y combinar ambos
    merged.raw = typeof prev.raw === "object" && typeof o.raw === "object"
      ? { ...(prev.raw as object), ...(o.raw as object) }
      : o.raw;
    return merged as NormalizedOrder;
  });
}

export async function ingestPayload(
  payload: unknown,
  source: "extension" | "cron",
  sourceUrl: string | null,
): Promise<number> {
  const orders = await mergeWithExisting(extractOrders(payload));
  const saved = await saveOrders(orders);

  const log = await db().from("ingest_log").insert({
    source,
    source_url: sourceUrl,
    orders_found: saved,
    payload,
  });
  if (log.error) console.error("ingest_log", log.error);
  return saved;
}

/** Vuelve a normalizar todos los pedidos desde su `raw` (tras ajustar el mapeo). */
export async function reprocessAll(): Promise<number> {
  let total = 0;
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db()
      .from("orders")
      .select("external_id, raw")
      .order("external_id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const orders = data.flatMap((r) => {
      const o = normalizeOrder(r.raw);
      return o ? [{ ...o, external_id: r.external_id as string }] : [];
    });
    total += await saveOrders(orders);
    if (data.length < pageSize) break;
  }
  return total;
}
