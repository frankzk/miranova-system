import "server-only";
import { db } from "./supabase";
import { synced } from "./synced-cache";
import type { StoreDetail } from "./store-metrics";

export type { StoreDay, StoreDetail } from "./store-metrics";

/** Ficha 360° de una tienda (función SQL `store_detail`); null si la tienda no tiene pedidos en esa cuenta. */
async function storeDetailQuery(accountId: string, storeId: string): Promise<StoreDetail | null> {
  const { data, error } = await db().rpc("store_detail", { p_account: accountId, p_store_id: storeId });
  if (error) throw error;
  return (data ?? null) as StoreDetail | null;
}
export const storeDetail = synced("store_detail", storeDetailQuery);
