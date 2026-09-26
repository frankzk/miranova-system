import "server-only";
import type { ProductPerf } from "./product-insights";
import { db } from "./supabase";

export type { ProductPerf } from "./product-insights";

/** Rendimiento de productos por cuenta (product_performance): una fila por producto, incluidos los activos sin pedidos. */
export async function productPerformance(account?: string): Promise<ProductPerf[]> {
  const { data, error } = await db().rpc("product_performance", { p_account: account ?? null });
  if (error) throw error;
  return (data ?? []) as ProductPerf[];
}
