import "server-only";
import { db } from "./supabase";

// Resumen Miranova: base de tiendas y ritmo del negocio (ver supabase/migrations/0016_active_stores.sql).

export type OverviewStore = {
  kind: "new" | "reactivated" | "stopped";
  account_id: string;
  store_id: string;
  account_name: string;
  name: string;
  /** nuevas/reactivadas: pedidos en 30 días; dejaron de vender: pedidos entre hace 44 y 14 días */
  orders: number;
  /** nuevas: primer pedido; demás: último pedido */
  at: string;
};

export type Overview = {
  orders_today: number;
  orders_7d: number;
  orders_prev7: number;
  orders_30d: number;
  units_per_order: number | null;
  tickets: { currency: string; ticket: number; orders: number }[];
  stores: { registered: number; active30: number; active7: number; active2d: number; new_month: number; reactivated: number; stopped: number };
  /** 12 semanas móviles, de la más antigua (k = 11) a la actual (k = 0) */
  weeks: { k: number; active: number; new: number; orders: number }[];
  lists: OverviewStore[];
};

export async function activeStores(account?: string): Promise<Overview> {
  const { data, error } = await db().rpc("active_stores", { p_account: account ?? null });
  if (error) throw error;
  return data as Overview;
}
