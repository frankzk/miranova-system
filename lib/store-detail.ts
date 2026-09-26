import "server-only";
import { db } from "./supabase";
import type { StoreDetail } from "./store-metrics";

export type { StoreDay, StoreDetail } from "./store-metrics";

/** Ficha 360° de una tienda (función SQL `store_detail`); null si la tienda no tiene pedidos en esa cuenta. */
export async function storeDetail(accountId: string, storeId: string): Promise<StoreDetail | null> {
  const { data, error } = await db().rpc("store_detail", { p_account: accountId, p_store_id: storeId });
  if (error) throw error;
  return (data ?? null) as StoreDetail | null;
}
