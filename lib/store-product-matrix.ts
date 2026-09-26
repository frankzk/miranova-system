import "server-only";
import type { MatrixData } from "./cross-sell";
import { db } from "./supabase";

export type { MatrixData } from "./cross-sell";

export const MATRIX_DAYS = [7, 30, 90] as const;

/** Pedidos por tienda × producto en el período (7, 30 o 90 días) y en 90 días (store_product_matrix). */
export async function storeProductMatrix(account: string | undefined, days: number): Promise<MatrixData> {
  const { data, error } = await db().rpc("store_product_matrix", { p_account: account ?? null, p_days: days });
  if (error) throw error;
  return (data ?? { days, accounts: [], stores: [], products: [], cells: [] }) as MatrixData;
}
