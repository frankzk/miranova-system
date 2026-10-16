"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth";
import { requestCountries } from "@/lib/store-requests-data";
import { cleanRequest, isRequestStatus, requestStatus } from "@/lib/store-requests";
import { db } from "@/lib/supabase";

// Solicitudes de tiendas: crear, editar, cambiar de estado y borrar.

export type RequestFormState = { ok: boolean; msg: string } | null;

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (msg: string): RequestFormState => ({ ok: false, msg });
const GONE = "Esa solicitud ya no existe.";

/** Nueva o editada: tienda, dueño, países, producto, cantidad y notas (al editar, también el estado). */
export async function saveRequest(_prev: RequestFormState, form: FormData): Promise<RequestFormState> {
  const auth = await authorizeAction("requests");
  if (!auth.ok) return auth;
  const id = field(form, "id");
  if (id && !UUID.test(id)) return fail(GONE);
  const allowed = (await requestCountries()).map((c) => c.code);
  const c = cleanRequest(
    {
      store_name: field(form, "store_name"),
      owner_name: field(form, "owner_name"),
      countries: form.getAll("countries").map(String),
      product: field(form, "product"),
      quantity: field(form, "quantity"),
      notes: field(form, "notes"),
    },
    allowed,
  );
  if (!c.ok) return fail(c.msg);
  const status = field(form, "status");
  if (status && !isRequestStatus(status)) return fail("Estado no válido.");
  const now = new Date().toISOString();
  if (id) {
    const { data, error } = await db()
      .from("store_requests")
      .update({ ...c.row, ...(status ? { status } : {}), updated_at: now })
      .eq("id", id)
      .select("id");
    if (error) return fail(`No se pudo guardar: ${error.message}`);
    if (!data?.length) return fail(GONE);
  } else {
    const { error } = await db().from("store_requests").insert({ ...c.row, status: "pending", created_by: auth.user.id, created_at: now, updated_at: now });
    if (error) return fail(`No se pudo guardar: ${error.message}`);
  }
  revalidatePath("/requests");
  return { ok: true, msg: id ? "Guardado." : `Solicitud de ${c.row.store_name} guardada.` };
}

/** Cambio rápido de estado desde la lista. */
export async function setRequestStatus(_prev: RequestFormState, form: FormData): Promise<RequestFormState> {
  const auth = await authorizeAction("requests");
  if (!auth.ok) return auth;
  const id = field(form, "id");
  const status = field(form, "status");
  if (!UUID.test(id)) return fail(GONE);
  if (!isRequestStatus(status)) return fail("Estado no válido.");
  const { data, error } = await db().from("store_requests").update({ status, updated_at: new Date().toISOString() }).eq("id", id).select("id");
  if (error) return fail(`No se pudo cambiar: ${error.message}`);
  if (!data?.length) return fail(GONE);
  revalidatePath("/requests");
  return { ok: true, msg: requestStatus(status).label };
}

export async function deleteRequest(_prev: RequestFormState, form: FormData): Promise<RequestFormState> {
  const auth = await authorizeAction("requests");
  if (!auth.ok) return auth;
  const id = field(form, "id");
  if (!UUID.test(id)) return fail(GONE);
  const { error } = await db().from("store_requests").delete().eq("id", id);
  if (error) return fail(`No se pudo borrar: ${error.message}`);
  revalidatePath("/requests");
  return { ok: true, msg: "Solicitud borrada." };
}
