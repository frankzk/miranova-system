"use server";

import { revalidatePath } from "next/cache";
import type { FollowupState } from "@/components/followup-forms";
import { authorizeAction } from "@/lib/auth";
import { isDay, isFollowupStatus } from "@/lib/store-metrics";
import { db } from "@/lib/supabase";

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 1000;

const fail = (msg: string): FollowupState => ({ ok: false, msg });
const done = (msg: string): FollowupState => {
  revalidatePath("/stores/[account]/[store]", "page");
  return { ok: true, msg };
};

/** Texto opcional: null si viene vacío; corta en MAX_TEXT. */
const text = (f: FormData, k: string, max = MAX_TEXT) => field(f, k).slice(0, max) || null;

/** Fecha opcional (YYYY-MM-DD): null si viene vacía, undefined si no es válida. */
function day(f: FormData, k: string): string | null | undefined {
  const v = field(f, k);
  if (!v) return null;
  return isDay(v) ? v : undefined;
}

export async function addFollowup(_prev: FollowupState, form: FormData): Promise<FollowupState> {
  const auth = await authorizeAction("stores_edit");
  if (!auth.ok) return fail(auth.msg);
  const accountId = field(form, "account_id");
  const storeId = field(form, "store_id");
  if (!UUID.test(accountId) || !storeId || storeId.length > 200) return fail("Tienda no válida.");

  const contacted = day(form, "contacted_at");
  const next = day(form, "next_followup");
  const status = field(form, "status") || "pendiente";
  if (!contacted) return fail("Indica la fecha de contacto.");
  if (next === undefined) return fail("La fecha del próximo seguimiento no es válida.");
  if (next && next < contacted) return fail("El próximo seguimiento no puede ser antes del contacto.");
  if (!isFollowupStatus(status)) return fail("Estado no válido.");
  const recommendation = text(form, "recommendation");
  const action = text(form, "action_taken");
  if (!recommendation && !action) return fail("Escribe la recomendación o la acción realizada.");

  const acc = await db().from("accounts").select("id").eq("id", accountId).maybeSingle();
  if (!acc.data) return fail("Cuenta no encontrada.");

  const { error } = await db().from("store_followups").insert({
    account_id: accountId,
    store_id: storeId,
    store_name: text(form, "store_name", 200),
    owner: text(form, "owner", 80),
    contacted_at: contacted,
    recommendation,
    action_taken: action,
    status,
    next_followup: next,
  });
  if (error) return fail(`No se pudo guardar: ${error.message}`);
  return done("Seguimiento guardado.");
}

export async function updateFollowup(_prev: FollowupState, form: FormData): Promise<FollowupState> {
  const auth = await authorizeAction("stores_edit");
  if (!auth.ok) return fail(auth.msg);
  const id = field(form, "id");
  const accountId = field(form, "account_id");
  const status = field(form, "status");
  const next = day(form, "next_followup");
  if (!UUID.test(id) || !UUID.test(accountId)) return fail("Seguimiento no válido.");
  if (!isFollowupStatus(status)) return fail("Estado no válido.");
  if (next === undefined) return fail("La fecha del próximo seguimiento no es válida.");

  const { data, error } = await db()
    .from("store_followups")
    .update({ status, next_followup: next, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("account_id", accountId)
    .select("id");
  if (error) return fail(`No se pudo actualizar: ${error.message}`);
  if (!data?.length) return fail("Seguimiento no encontrado.");
  return done("Actualizado.");
}
