"use server";

import { revalidatePath } from "next/cache";
import type { RestockState } from "@/components/restock-forms";
import { authorizeAction } from "@/lib/auth";
import { REORDER } from "@/lib/inventory";
import { runRestockDigest } from "@/lib/restock-digest-send";
import { db } from "@/lib/supabase";

// Registrar reposiciones pedidas y el tiempo que tardan en llegar: permiso Productos (no pide
// nada al proveedor; solo lleva la cuenta de lo que ya viene en camino).

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const fail = (msg: string): RestockState => ({ ok: false, msg });
const done = (msg: string): RestockState => {
  revalidatePath("/products/inventory");
  revalidatePath("/opportunities");
  return { ok: true, msg };
};

/** Producto del formulario, que debe estar en el catálogo de esa cuenta. */
async function productOf(form: FormData) {
  const accountId = field(form, "account_id");
  const externalId = field(form, "product_id");
  if (!UUID.test(accountId) || !externalId || externalId.length > 200) return null;
  const { data } = await db().from("products").select("external_id").eq("account_id", accountId).eq("external_id", externalId).maybeSingle();
  return data ? { accountId, externalId } : null;
}

export async function placeRestockOrder(_prev: RestockState, form: FormData): Promise<RestockState> {
  const auth = await authorizeAction("products");
  if (!auth.ok) return auth;
  const p = await productOf(form);
  if (!p) return fail("Ese producto ya no está en el catálogo.");
  const units = Number(field(form, "units"));
  if (!Number.isInteger(units) || units <= 0 || units > 1_000_000) return fail("Escribe cuántas unidades pediste: un número entero mayor que 0.");
  const eta = field(form, "eta");
  if (eta && (!DAY.test(eta) || Number.isNaN(Date.parse(eta)))) return fail("La fecha de llegada no es válida.");
  const { error } = await db().from("restock_orders").insert({
    account_id: p.accountId,
    product_external_id: p.externalId,
    units,
    eta: eta || null,
    note: field(form, "note").slice(0, 300) || null,
    ordered_at: new Date().toISOString(),
    created_by: auth.user.id,
  });
  if (error) return fail(`No se pudo guardar: ${error.message}`);
  return done(`Listo: ${units.toLocaleString("en-US")} u. en camino.`);
}

export async function cancelRestockOrder(_prev: RestockState, form: FormData): Promise<RestockState> {
  const auth = await authorizeAction("products");
  if (!auth.ok) return auth;
  const id = field(form, "order_id");
  if (!UUID.test(id)) return fail("Ese pedido no existe.");
  const { error } = await db().from("restock_orders").update({ cancelled_at: new Date().toISOString() }).eq("id", id).is("cancelled_at", null);
  if (error) return fail(`No se pudo cancelar: ${error.message}`);
  return done("Pedido cancelado.");
}

export async function saveLeadTime(_prev: RestockState, form: FormData): Promise<RestockState> {
  const auth = await authorizeAction("products");
  if (!auth.ok) return auth;
  const p = await productOf(form);
  if (!p) return fail("Ese producto ya no está en el catálogo.");
  const raw = field(form, "lead_days");
  const days = Number(raw);
  if (raw && (!Number.isInteger(days) || days < 1 || days > REORDER.maxLead)) return fail(`Escribe un número de días entre 1 y ${REORDER.maxLead}.`);
  // borrar y volver a insertar: lo mismo que un upsert, y funciona igual con los datos de prueba
  const del = await db().from("product_lead_times").delete().eq("account_id", p.accountId).eq("product_external_id", p.externalId);
  if (del.error) return fail(`No se pudo guardar: ${del.error.message}`);
  if (!raw) return done("Listo: vuelve a usar lo medido con los pedidos que llegan.");
  const { error } = await db().from("product_lead_times").insert({
    account_id: p.accountId, product_external_id: p.externalId, lead_days: days, updated_by: auth.user.id, updated_at: new Date().toISOString(),
  });
  if (error) return fail(`No se pudo guardar: ${error.message}`);
  return done(`Listo: ${days} ${days === 1 ? "día" : "días"} de reposición.`);
}

/** Envía ahora el resumen de "qué pedir hoy" (aunque no haya nada), para probar el correo. Solo el dueño. */
export async function sendDigestNow(_prev: RestockState, _form: FormData): Promise<RestockState> {
  const auth = await authorizeAction();
  if (!auth.ok) return auth;
  if (!auth.user.is_owner) return fail("Solo el dueño puede enviar el resumen.");
  const run = await runRestockDigest({ force: true });
  if (!run.ok) return fail(run.error);
  return { ok: true, msg: `Resumen enviado a ${run.to.join(", ")}.` };
}
