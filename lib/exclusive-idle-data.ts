import "server-only";
import { normalizeExclusive, type ExclusiveIdleRow } from "./exclusive-idle";
import { db } from "./supabase";
import { synced } from "./synced-cache";

// función que todavía no existe (migración sin aplicar): la pantalla se ve igual, sin lo privatizado
const missingFunction = (e: { code?: string }) => e.code === "PGRST202" || e.code === "42883";

/** Lo privatizado a cada tienda y cuándo pidió ese producto por última vez (exclusive_idle). */
async function exclusiveIdleQuery(account?: string): Promise<ExclusiveIdleRow[]> {
  const { data, error } = await db().rpc("exclusive_idle", { p_account: account ?? null });
  if (error) {
    if (missingFunction(error)) return [];
    throw error;
  }
  return normalizeExclusive((data ?? []) as Partial<ExclusiveIdleRow>[]);
}

/** Guardada hasta la próxima sincronización (pedidos y movimientos llegan juntos). */
export const exclusiveIdle = synced("exclusive_idle", exclusiveIdleQuery);
