import "server-only";
import { db } from "./supabase";
import { isLabStatus, parseDistribution, type LabPurchase } from "./lab-purchases";

// tabla que todavía no existe (migración 0046 sin aplicar): la sección se ve vacía en vez de fallar
const missingTable = (e: { code?: string }) => e.code === "42P01" || e.code === "PGRST205";

export type LabRow = LabPurchase & { created_by_name: string | null };

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

/** Todas las compras a laboratorios, de la más reciente a la más vieja (por fecha de solicitud). */
export async function listLabPurchases(): Promise<LabRow[]> {
  const [{ data, error }, users] = await Promise.all([
    db().from("lab_purchases").select("*").order("requested_at", { ascending: false }).order("created_at", { ascending: false }).limit(5000),
    db().from("app_users").select("id, name"),
  ]);
  if (error) {
    if (missingTable(error)) return [];
    throw error;
  }
  const names = new Map(((users.data ?? []) as { id: string; name: string }[]).map((u) => [u.id, u.name]));
  return ((data ?? []) as LabPurchase[]).map((r) => ({
    ...r,
    status: isLabStatus(r.status) ? r.status : "requested",
    boxes: num(r.boxes),
    qty_requested: Number(r.qty_requested),
    qty_courtesy: Number(r.qty_courtesy ?? 0),
    distribution: parseDistribution(r.distribution),
    unit_price_gtq: num(r.unit_price_gtq),
    fx_gtq_per_usd: num(r.fx_gtq_per_usd),
    created_by_name: r.created_by ? names.get(r.created_by) ?? null : null,
  }));
}

/**
 * Quetzales por dólar para una compra nueva: el de la cuenta de Guatemala (Drop), redondeado a
 * 2 decimales; si no hay, 7.75.
 */
export async function defaultGtqRate(): Promise<number> {
  const { data } = await db().from("account_fx").select("usd_rate, currency").eq("currency", "GTQ");
  const rate = ((data ?? []) as { usd_rate: number | null }[]).map((r) => Number(r.usd_rate)).find((r) => r > 0);
  return rate ? Math.round((1 / rate) * 100) / 100 : 7.75;
}
