import "server-only";
import { db } from "./supabase";
import { OPEN_STATUSES, summarizeFollowups, type FollowupStatus, type FollowupSummary } from "./store-metrics";

export type Followup = {
  id: string;
  account_id: string;
  store_id: string;
  store_name: string | null;
  owner: string | null;
  /** Fecha de contacto (YYYY-MM-DD). */
  contacted_at: string;
  recommendation: string | null;
  action_taken: string | null;
  status: FollowupStatus;
  next_followup: string | null;
  created_at: string;
  updated_at: string;
};

/** Historial de seguimiento de una tienda, el más reciente primero. */
export async function listFollowups(accountId: string, storeId: string): Promise<Followup[]> {
  const { data, error } = await db()
    .from("store_followups")
    .select("*")
    .eq("account_id", accountId)
    .eq("store_id", storeId)
    .order("contacted_at", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Followup[];
}

/** Seguimientos abiertos (pendiente / en curso), por fecha del próximo seguimiento (sin fecha al final). */
export async function pendingFollowups(account?: string): Promise<Followup[]> {
  let q = db().from("store_followups").select("*").in("status", OPEN_STATUSES);
  if (account) q = q.eq("account_id", account);
  const { data, error } = await q
    .order("next_followup", { ascending: true, nullsFirst: false })
    .order("contacted_at", { ascending: true });
  if (error) throw error;
  // el orden de nulos se asegura aquí también (la simulación local no lo aplica)
  return ((data ?? []) as Followup[]).sort((a, b) => (a.next_followup === null ? 1 : 0) - (b.next_followup === null ? 1 : 0));
}

/** Responsables usados antes (para sugerirlos en el formulario). */
export async function followupOwners(): Promise<string[]> {
  const { data, error } = await db().from("store_followups").select("owner").order("updated_at", { ascending: false }).limit(500);
  if (error) throw error;
  return [...new Set((data ?? []).map((r: { owner: string | null }) => r.owner?.trim()).filter((x): x is string => !!x))];
}

/** Resumen del seguimiento de todas las tiendas (para los listados), por "cuenta|tienda". */
export async function followupIndex(account?: string): Promise<Map<string, FollowupSummary>> {
  let q = db().from("store_followups").select("account_id, store_id, contacted_at, owner, status, next_followup");
  if (account) q = q.eq("account_id", account);
  const { data, error } = await q.limit(5000);
  if (error) throw error;
  return summarizeFollowups((data ?? []) as Parameters<typeof summarizeFollowups>[0]);
}
