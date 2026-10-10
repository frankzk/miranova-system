import "server-only";
import { IN_DROP, INBOUND, importOrders, type SupplyImport, type SupplyItem } from "./imports";
import { NO_SUPPLY, productKey, type InventoryRow, type Restock, type RestockOrder, type Supply } from "./inventory";
import { db } from "./supabase";

/** Inventario por producto (ver supabase/migrations/0018_inventory_status.sql). */
export async function inventoryStatus(account?: string): Promise<InventoryRow[]> {
  const { data, error } = await db().rpc("inventory_status", { p_account: account ?? null });
  if (error) throw error;
  return (data ?? []) as InventoryRow[];
}

// tabla que todavía no existe (migración 0027 sin aplicar): el inventario se ve igual, sin pedidos
const missingTable = (e: { code?: string }) => e.code === "42P01" || e.code === "PGRST205";

/**
 * Pedidos de reposición de los últimos 180 días, líneas de importación pagadas que no han entrado
 * a Drop (y las que entraron en esos 180 días, para medir cuánto tardan) y tiempos de reposición
 * fijados a mano (migraciones 0027 y 0035).
 */
export async function inventorySupply(account?: string): Promise<Supply> {
  const [supply, imported] = await Promise.all([restockSupply(account), importedOrders(account)]);
  return imported.length ? { ...supply, orders: [...supply.orders, ...imported] } : supply;
}

async function restockSupply(account?: string): Promise<Supply> {
  const since = new Date(Date.now() - 180 * 86_400_000).toISOString();
  let orders = db()
    .from("restock_orders")
    .select("id, account_id, product_external_id, units, ordered_at, eta, note, cancelled_at")
    .gte("ordered_at", since)
    .order("ordered_at", { ascending: false });
  let leads = db().from("product_lead_times").select("account_id, product_external_id, lead_days");
  if (account) {
    orders = orders.eq("account_id", account);
    leads = leads.eq("account_id", account);
  }
  const [o, l] = await Promise.all([orders, leads]);
  if (o.error || l.error) {
    const e = (o.error ?? l.error)!;
    if (missingTable(e)) return NO_SUPPLY;
    throw e;
  }
  return {
    orders: (o.data ?? []).map((r) => ({ ...r, units: Number(r.units) }) as RestockOrder),
    leads: new Map((l.data ?? []).map((r) => [productKey(r.account_id as string, r.product_external_id as string), Number(r.lead_days)])),
  };
}

/** Líneas de importación como pedidos en camino (ver importOrders). */
async function importedOrders(account?: string): Promise<RestockOrder[]> {
  const { data: imps, error } = await db()
    .from("imports")
    .select("id, code, supplier, status, ordered_at, created_at, eta, arrived_at, updated_at")
    .in("status", [...INBOUND, ...IN_DROP]);
  if (error) {
    if (missingTable(error)) return [];
    throw error;
  }
  const since = Date.now() - 180 * 86_400_000;
  const list = ((imps ?? []) as SupplyImport[]).filter(
    (i) => !(IN_DROP as string[]).includes(i.status) || Date.parse(i.arrived_at ?? i.updated_at ?? i.created_at) >= since,
  );
  if (!list.length) return [];
  let q = db()
    .from("import_items")
    .select("id, import_id, account_id, product_external_id, qty, received_qty, damaged_qty")
    .in("import_id", list.map((i) => i.id));
  if (account) q = q.eq("account_id", account);
  const { data: items, error: e } = await q;
  if (e) throw e;
  const rows = ((items ?? []) as SupplyItem[]).map((i) => ({
    ...i, qty: Number(i.qty), received_qty: i.received_qty === null || i.received_qty === undefined ? null : Number(i.received_qty), damaged_qty: Number(i.damaged_qty ?? 0),
  }));
  return importOrders(list, rows);
}

/** Entradas de mercadería de Drop (como `restocks` de inventory_status) de unos productos, desde una fecha. */
export async function stockEntries(products: { account_id: string; external_id: string }[], since: string): Promise<Map<string, Restock[]>> {
  const out = new Map<string, Restock[]>();
  if (!products.length) return out;
  const wanted = new Set(products.map((p) => productKey(p.account_id, p.external_id)));
  const { data, error } = await db()
    .from("stock_movements")
    .select("account_id, product_external_id, units, reason, occurred_at")
    .in("account_id", [...new Set(products.map((p) => p.account_id))])
    .in("product_external_id", [...new Set(products.map((p) => p.external_id))])
    .in("reason", ["STOCK_REQUEST", "INITIAL_STOCK", "MANUAL"])
    .gt("units", 0)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(2000);
  if (error) {
    if (missingTable(error)) return out;
    throw error;
  }
  for (const m of (data ?? []) as { account_id: string; product_external_id: string; units: number; reason: string; occurred_at: string }[]) {
    const key = productKey(m.account_id, m.product_external_id);
    if (!wanted.has(key)) continue;
    out.set(key, [...(out.get(key) ?? []), { at: m.occurred_at, units: Number(m.units), reason: m.reason }]);
  }
  return out;
}
