"use server";

import { revalidatePath } from "next/cache";
import type { ImportFormState } from "@/components/import-forms";
import { authorizeAction } from "@/lib/auth";
import { db } from "@/lib/supabase";

// Proveedores de importaciones: crear (también desde la ventana de "Nueva importación"), editar y borrar.

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (msg: string): ImportFormState => ({ ok: false, msg });

export type SupplierOption = { id: string; name: string; origin: string | null };

type Fields = { name: string; origin: string | null; contact: string | null; whatsapp: string | null; email: string | null; payment_terms: string | null; notes: string | null };

function clean(input: Record<string, string>): { ok: true; row: Fields } | { ok: false; msg: string } {
  const name = (input.name ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!name) return { ok: false, msg: "Escribe el nombre del proveedor." };
  const email = (input.email ?? "").trim().slice(0, 160);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, msg: "El correo no es válido." };
  const whatsapp = (input.whatsapp ?? "").trim().slice(0, 40);
  if (whatsapp && whatsapp.replace(/\D/g, "").length < 7) return { ok: false, msg: "El WhatsApp debe tener el número completo, con código de país." };
  const opt = (k: string, max: number) => (input[k] ?? "").trim().slice(0, max) || null;
  return {
    ok: true,
    row: { name, origin: opt("origin", 80), contact: opt("contact", 120), whatsapp: whatsapp || null, email: email || null, payment_terms: opt("payment_terms", 300), notes: opt("notes", 2000) },
  };
}

async function nameTaken(name: string, exceptId?: string): Promise<boolean> {
  const { data } = await db().from("import_suppliers").select("id, name");
  return ((data ?? []) as { id: string; name: string }[]).some((s) => s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase());
}

/** Desde la ventana de "Nueva importación": nombre, origen y WhatsApp. Devuelve el proveedor para elegirlo enseguida. */
export async function quickCreateSupplier(input: { name: string; origin: string; whatsapp: string }): Promise<{ ok: true; supplier: SupplierOption } | { ok: false; msg: string }> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const c = clean({ name: String(input?.name ?? ""), origin: String(input?.origin ?? ""), whatsapp: String(input?.whatsapp ?? "") });
  if (!c.ok) return c;
  if (await nameTaken(c.row.name)) return { ok: false, msg: `Ya existe un proveedor llamado "${c.row.name}": elígelo de la lista.` };
  const now = new Date().toISOString();
  const { data, error } = await db().from("import_suppliers").insert({ ...c.row, created_by: auth.user.id, created_at: now, updated_at: now }).select("id, name, origin").single();
  if (error || !data) return { ok: false, msg: /duplicate|unique/i.test(error?.message ?? "") ? "Ya existe un proveedor con ese nombre." : `No se pudo guardar: ${error?.message ?? "sin respuesta"}` };
  revalidatePath("/imports/suppliers");
  return { ok: true, supplier: data as SupplierOption };
}

/** Crear o editar desde el directorio (todos los datos). Al cambiar el nombre, se actualiza en sus importaciones. */
export async function saveSupplier(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const id = field(form, "id");
  if (id && !UUID.test(id)) return fail("Ese proveedor ya no existe.");
  const c = clean(Object.fromEntries(["name", "origin", "contact", "whatsapp", "email", "payment_terms", "notes"].map((k) => [k, field(form, k)])));
  if (!c.ok) return fail(c.msg);
  if (await nameTaken(c.row.name, id || undefined)) return fail(`Ya existe un proveedor llamado "${c.row.name}".`);
  const now = new Date().toISOString();
  if (id) {
    const { data, error } = await db().from("import_suppliers").update({ ...c.row, updated_at: now }).eq("id", id).select("id");
    if (error) return fail(`No se pudo guardar: ${error.message}`);
    if (!data?.length) return fail("Ese proveedor ya no existe.");
    await db().from("imports").update({ supplier: c.row.name }).eq("supplier_id", id);
  } else {
    const { error } = await db().from("import_suppliers").insert({ ...c.row, created_by: auth.user.id, created_at: now, updated_at: now });
    if (error) return fail(/duplicate|unique/i.test(error.message) ? "Ya existe un proveedor con ese nombre." : `No se pudo guardar: ${error.message}`);
  }
  revalidatePath("/imports/suppliers");
  revalidatePath("/imports");
  return { ok: true, msg: id ? "Guardado." : `Proveedor "${c.row.name}" creado.` };
}

/** Solo se borra si no tiene importaciones (para no perder de quién fue cada compra). */
export async function deleteSupplier(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const id = field(form, "id");
  if (!UUID.test(id)) return fail("Ese proveedor ya no existe.");
  const { data: used } = await db().from("imports").select("id").eq("supplier_id", id).limit(1);
  if (used?.length) return fail("Tiene importaciones: no se puede borrar. Puedes cambiarle el nombre o los datos.");
  const { error } = await db().from("import_suppliers").delete().eq("id", id);
  if (error) return fail(`No se pudo borrar: ${error.message}`);
  revalidatePath("/imports/suppliers");
  return { ok: true, msg: "Proveedor borrado." };
}
