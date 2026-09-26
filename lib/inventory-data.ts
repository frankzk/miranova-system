import "server-only";
import type { InventoryRow } from "./inventory";
import { db } from "./supabase";

/** Inventario por producto (ver supabase/migrations/0018_inventory_status.sql). */
export async function inventoryStatus(account?: string): Promise<InventoryRow[]> {
  const { data, error } = await db().rpc("inventory_status", { p_account: account ?? null });
  if (error) throw error;
  return (data ?? []) as InventoryRow[];
}
