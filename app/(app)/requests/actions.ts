"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth";
import { todayIn } from "@/lib/format";
import {
  removePhotos, requestCountries, searchDropCatalog, signedPhotoUpload, storedPhoto,
} from "@/lib/store-requests-data";
import {
  cleanProductName, cleanRequest, isRequestPhotoPath, isRequestStatus, MAX_REQUEST_PHOTO_BYTES, norm, REQUEST_PHOTO_TYPES, requestPhotoProblem, requestPhotoType, requestStatus,
  type DropProductRef, type RequestProduct,
} from "@/lib/store-requests";
import { db } from "@/lib/supabase";

// Solicitudes de tiendas y clientes potenciales: crear, editar, cambiar de estado y borrar; y los
// productos nuevos (lo que piden y todavía no está en Drop): crearlos con su foto y vincularlos.

export type RequestFormState = { ok: boolean; msg: string } | null;
type Result<T = object> = ({ ok: true } & T) | { ok: false; msg: string };

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (msg: string): RequestFormState => ({ ok: false, msg });
const GONE = "Esa solicitud ya no existe.";

/** Filas de producto del formulario (product[] y quantity[] en el mismo orden). */
function itemsFrom(form: FormData) {
  const products = form.getAll("product").map(String);
  const quantities = form.getAll("quantity").map(String);
  const allocations = form.getAll("country_quantities").map(String);
  return products.map((product, i) => {
    let country_quantities: Record<string, string> = {};
    try {
      const raw = allocations[i] || "{}";
      if (raw.length > 2000) throw new Error("Too large");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid allocation");
      country_quantities = parsed;
    } catch { country_quantities = { INVALID: "1" }; }
    return { product, quantity: quantities[i] ?? "", country_quantities };
  });
}

/**
 * Nueva o editada: tienda o cliente potencial (con su contacto), tipo de solicitud, países, productos
 * con su cantidad, fechas, origen y notas (al editar, también el estado).
 */
export async function saveRequest(_prev: RequestFormState, form: FormData): Promise<RequestFormState> {
  const auth = await authorizeAction("requests");
  if (!auth.ok) return auth;
  const id = field(form, "id");
  if (id && !UUID.test(id)) return fail(GONE);
  const allowed = (await requestCountries()).map((c) => c.code);
  const c = cleanRequest(
    {
      client_kind: field(form, "client_kind"),
      request_type: field(form, "request_type"),
      store_name: field(form, "store_name"),
      owner_name: field(form, "owner_name"),
      contact_phone: field(form, "contact_phone"),
      contact_email: field(form, "contact_email"),
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
  const lines = (requestId: string) => items.map((it, position) => ({ request_id: requestId, position, product: it.product, quantity: it.quantity, country_quantities: it.country_quantities ?? {} }));
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

// ─── Productos nuevos ───

const NO_TABLE = "Falta preparar la base de datos para los productos nuevos. Avísale al administrador.";
const PRODUCT_GONE = "Ese producto nuevo ya no existe.";
const missingTable = (e: { code?: string }) => e.code === "42P01" || e.code === "PGRST205";
/** Enlace a la foto, con su versión: si cambia la foto, el navegador no muestra la vieja. */
const photoUrl = (id: string, path: string | null) => (path ? `/api/requests/products/${id}/photo?v=${path.slice(9, 17)}` : null);

/** Prepara la subida de la foto de un producto nuevo: devuelve el enlace firmado y la ruta. */
export async function startRequestPhotoUpload(filename: string, type: string, size: number): Promise<Result<{ path: string; url: string; type: string }>> {
  const auth = await authorizeAction("requests");
  if (!auth.ok) return auth;
  const name = String(filename ?? "").slice(0, 200);
  const problem = requestPhotoProblem(String(type ?? ""), name, Number(size));
  if (problem) return { ok: false, msg: problem };
  const ct = requestPhotoType(String(type ?? ""), name)!;
  try {
    return { ok: true, type: ct, ...(await signedPhotoUpload(ct)) };
  } catch {
    return { ok: false, msg: "No se pudo preparar la subida de la foto. Inténtalo de nuevo." };
  }
}

/**
 * Crea un producto nuevo con su nombre y, si se subió, su foto. Si ya hay uno con ese nombre (sin
 * importar mayúsculas ni tildes), se usa ese; y si se eligió una foto, queda como su foto.
 */
export async function createRequestProduct(input: { name?: string; photo_path?: string | null }): Promise<Result<{ product: Pick<RequestProduct, "id" | "name" | "photo">; existed: boolean }>> {
  const auth = await authorizeAction("requests");
  if (!auth.ok) return auth;
  const name = cleanProductName(String(input?.name ?? ""));
  const key = norm(name);
  if (!key) return { ok: false, msg: "Escribe el nombre del producto." };
  const photo = input?.photo_path ? String(input.photo_path) : null;
  const drop = async (msg: string): Promise<Result<never>> => {
    if (photo) await removePhotos([photo]).catch(() => {});
    return { ok: false, msg };
  };
  if (photo) {
    if (!isRequestPhotoPath(photo)) return { ok: false, msg: "Ruta de la foto no válida." };
    const info = await storedPhoto(photo);
    if (!info) return { ok: false, msg: "La foto no llegó a guardarse; vuelve a elegirla." };
    if (!REQUEST_PHOTO_TYPES[info.contentType] || info.size > MAX_REQUEST_PHOTO_BYTES) return drop("La foto debe ser JPG, PNG o WEBP de hasta 10 MB.");
    // una foto ya guardada de otro producto no se reutiliza (ni se borra)
    const { data: taken } = await db().from("request_products").select("id").eq("photo_path", photo).limit(1);
    if (taken?.length) return { ok: false, msg: "Esa foto ya es de otro producto; vuelve a elegirla." };
  }
  const now = new Date().toISOString();
  type Found = { id: string; name: string; photo_path: string | null };
  const find = () => db().from("request_products").select("id, name, photo_path").eq("name_key", key).maybeSingle();
  const first = await find();
  if (first.error) return drop(missingTable(first.error) ? NO_TABLE : `No se pudo guardar: ${first.error.message}`);
  let found = first.data as Found | null;
  if (!found) {
    const ins = await db()
      .from("request_products")
      .insert({ name, name_key: key, photo_path: photo, created_by: auth.user.id, created_at: now, updated_at: now })
      .select("id, name, photo_path")
      .single();
    if (!ins.error && ins.data) {
      const p = ins.data as Found;
      revalidatePath("/requests");
      return { ok: true, existed: false, product: { id: p.id, name: p.name, photo: photoUrl(p.id, p.photo_path) } };
    }
    // otra persona lo creó a la vez: se usa ese
    if (ins.error?.code !== "23505") return drop(ins.error && missingTable(ins.error) ? NO_TABLE : `No se pudo guardar: ${ins.error?.message ?? "sin respuesta"}`);
    found = (await find()).data as Found | null;
    if (!found) return drop("No se pudo guardar el producto. Inténtalo de nuevo.");
  }
  if (photo) {
    const { error } = await db().from("request_products").update({ photo_path: photo, updated_at: now }).eq("id", found.id);
    if (error) return drop(`No se pudo guardar la foto: ${error.message}`);
    if (found.photo_path && found.photo_path !== photo) await removePhotos([found.photo_path]).catch(() => {});
    found = { ...found, photo_path: photo };
  }
  revalidatePath("/requests");
  return { ok: true, existed: true, product: { id: found.id, name: found.name, photo: photoUrl(found.id, found.photo_path) } };
}

/** Productos del catálogo de Drop (de todas las cuentas) para vincular un producto nuevo. */
export async function searchDropProducts(term: string): Promise<Result<{ results: DropProductRef[] }>> {
  const auth = await authorizeAction("requests");
  if (!auth.ok) return auth;
  try {
    return { ok: true, results: await searchDropCatalog(String(term ?? "")) };
  } catch {
    return { ok: false, msg: "No se pudo buscar en el catálogo. Inténtalo de nuevo." };
  }
}

/** Vincula un producto nuevo con el producto de Drop (o lo desvincula con `target` null). */
export async function linkRequestProduct(id: string, target: { account_id: string; external_id: string } | null): Promise<Result<{ msg: string }>> {
  const auth = await authorizeAction("requests");
  if (!auth.ok) return auth;
  if (!UUID.test(String(id ?? ""))) return { ok: false, msg: PRODUCT_GONE };
  const now = new Date().toISOString();
  let patch: Record<string, string | null> = { account_id: null, product_external_id: null, linked_at: null, updated_at: now };
  let msg = "Desvinculado de Drop.";
  if (target) {
    const account_id = String(target.account_id ?? "");
    const external_id = String(target.external_id ?? "").trim().slice(0, 120);
    if (!UUID.test(account_id) || !external_id) return { ok: false, msg: "Producto de Drop no válido." };
    const { data: p, error } = await db().from("products").select("name").eq("account_id", account_id).eq("external_id", external_id).maybeSingle();
    if (error) return { ok: false, msg: `No se pudo vincular: ${error.message}` };
    if (!p) return { ok: false, msg: "Ese producto ya no está en el catálogo de Drop." };
    patch = { account_id, product_external_id: external_id, linked_at: now, updated_at: now };
    msg = `Vinculado con “${(p as { name: string }).name}”.`;
  }
  const { data, error } = await db().from("request_products").update(patch).eq("id", id).select("id");
  if (error) return { ok: false, msg: missingTable(error) ? NO_TABLE : `No se pudo guardar: ${error.message}` };
  if (!data?.length) return { ok: false, msg: PRODUCT_GONE };
  revalidatePath("/requests");
  return { ok: true, msg };
}
