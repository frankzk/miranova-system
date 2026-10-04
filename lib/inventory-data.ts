import "server-only";
import { NO_SUPPLY, productKey, type InventoryRow, type RestockOrder, type Supply } from "./inventory";
import { db } from "./supabase";

/** Inventario por producto (ver supabase/migrations/0018_inventory_status.sql). */
export async function inventoryStatus(account?: string): Promise<InventoryRow[]> {
  const { data, error } = await db().rpc("inventory_status", { p_account: account ?? null });
  if (error) throw error;
  return (data ?? []) as InventoryRow[];
}

// tabla que todavía no existe (migración 0027 sin aplicar): el inventario se ve igual, sin pedidos
const missingTable = (e: { code?: string }) => e.code === "42P01" || e.code === "PGRST205";

/** Pedidos de reposición de los últimos 180 días y tiempos de reposición fijados a mano (migración 0027). */
export async function inventorySupply(account?: string): Promise<Supply> {
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
