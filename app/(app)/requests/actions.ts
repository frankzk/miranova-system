"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth";
import { todayIn } from "@/lib/format";
import { requestCountries } from "@/lib/store-requests-data";
import { cleanRequest, isRequestStatus, requestStatus } from "@/lib/store-requests";
import { db } from "@/lib/supabase";

// Solicitudes de tiendas: crear, editar, cambiar de estado y borrar.

export type RequestFormState = { ok: boolean; msg: string } | null;

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (msg: string): RequestFormState => ({ ok: false, msg });
const GONE = "Esa solicitud ya no existe.";

/** Filas de producto del formulario (product[] y quantity[] en el mismo orden). */
function itemsFrom(form: FormData) {
  const products = form.getAll("product").map(String);
  const quantities = form.getAll("quantity").map(String);
  return products.map((product, i) => ({ product, quantity: quantities[i] ?? "" }));
}

/** Nueva o editada: tienda, dueño, países, producto, cantidad, fechas, origen y notas (al editar, también el estado). */
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
      items: itemsFrom(form),
      notes: field(form, "notes"),
      requested_at: field(form, "requested_at"),
      arrival_at: field(form, "arrival_at"),
      origin_country: field(form, "origin_country"),
    },
    allowed,
    todayIn(),
  );
  if (!c.ok) return fail(c.msg);
  const status = field(form, "status");
  if (status && !isRequestStatus(status)) return fail("Estado no válido.");
  const now = new Date().toISOString();
  const { items, ...row } = c.row;
  const lines = (requestId: string) => items.map((it, position) => ({ request_id: requestId, position, product: it.product, quantity: it.quantity }));
  if (id) {
    const { data, error } = await db()
      .from("store_requests")
      .update({ ...row, ...(status ? { status } : {}), updated_at: now })
      .eq("id", id)
      .select("id");
    if (error) return fail(`No se pudo guardar: ${error.message}`);
    if (!data?.length) return fail(GONE);
    // primero las líneas nuevas y después se quitan las viejas: si algo falla, no se pierde el pedido
    const { data: old, error: readErr } = await db().from("store_request_items").select("id").eq("request_id", id);
    if (readErr) return fail(`No se pudieron guardar los productos: ${readErr.message}`);
    const { error: insErr } = await db().from("store_request_items").insert(lines(id));
    if (insErr) return fail(`No se pudieron guardar los productos: ${insErr.message}`);
    const oldIds = ((old ?? []) as { id: string }[]).map((o) => o.id);
    if (oldIds.length) await db().from("store_request_items").delete().in("id", oldIds);
  } else {
    const { data, error } = await db()
      .from("store_requests")
      .insert({ ...row, status: "pending", created_by: auth.user.id, created_at: now, updated_at: now })
      .select("id")
      .single();
    if (error || !data) return fail(`No se pudo guardar: ${error?.message ?? "sin respuesta"}`);
    const newId = (data as { id: string }).id;
    const { error: insErr } = await db().from("store_request_items").insert(lines(newId));
    if (insErr) {
      await db().from("store_requests").delete().eq("id", newId);
      return fail(`No se pudieron guardar los productos: ${insErr.message}`);
    }
  }
  revalidatePath("/requests");
  const n = c.row.items.length;
  return { ok: true, msg: id ? "Guardado." : `Solicitud de ${c.row.store_name} guardada${n > 1 ? ` (${n} productos)` : ""}.` };
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
