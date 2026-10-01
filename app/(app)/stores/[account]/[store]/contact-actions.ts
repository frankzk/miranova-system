"use server";

import { revalidatePath } from "next/cache";
import type { ContactState } from "@/components/contact-forms";
import { authorizeAction } from "@/lib/auth";
import { normalizeEmail, normalizePhone, parseWhatsappGroup, type StoreContact } from "@/lib/store-contacts";
import { db } from "@/lib/supabase";

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (msg: string): ContactState => ({ ok: false, msg });
const done = (msg: string): ContactState => {
  revalidatePath("/stores/[account]/[store]", "page");
  revalidatePath("/stores");
  revalidatePath("/stores/nuevas");
  return { ok: true, msg };
};

/** Tienda del formulario (cuenta + ID) y el país de la cuenta, o un error. */
async function storeOf(form: FormData) {
  const accountId = field(form, "account_id");
  const storeId = field(form, "store_id");
  if (!UUID.test(accountId) || !storeId || storeId.length > 200) return null;
  const { data } = await db().from("accounts").select("id, country").eq("id", accountId).maybeSingle();
  if (!data) return null;
  return { accountId, storeId, storeName: field(form, "store_name").slice(0, 200) || null, country: String(data.country ?? "") };
}

/** Nombre de una tienda del contacto, para explicar en qué contacto está un grupo o teléfono. */
async function describe(contactId: string) {
  const { data } = await db().from("store_contact_links").select("store_name").eq("contact_id", contactId).limit(1);
  return data?.[0]?.store_name ?? "otra tienda";
}

async function findBy(col: "whatsapp_group_code" | "owner_phone", v: string | null): Promise<StoreContact | null> {
  if (!v) return null;
  const { data } = await db().from("store_contacts").select("*").eq(col, v).maybeSingle();
  return (data as StoreContact | null) ?? null;
}

const dup = (e: { code?: string; message: string }) =>
  e.code === "23505" ? "Ese grupo o teléfono ya está guardado en otro contacto." : `No se pudo guardar: ${e.message}`;

/**
 * Guarda el contacto de la tienda. Si la tienda ya tiene contacto, lo edita. Si no, y el grupo
 * o el teléfono ya están en otro contacto, vincula la tienda a ese contacto en vez de duplicarlo.
 */
export async function saveContact(_prev: ContactState, form: FormData): Promise<ContactState> {
  const auth = await authorizeAction("stores_edit");
  if (!auth.ok) return fail(auth.msg);
  const store = await storeOf(form);
  if (!store) return fail("Tienda no válida.");

  const groupIn = field(form, "group");
  const phoneIn = field(form, "phone");
  const group = groupIn ? parseWhatsappGroup(groupIn) : null;
  if (groupIn && !group) return fail("Pega el enlace de invitación del grupo (https://chat.whatsapp.com/…).");
  const phone = phoneIn ? normalizePhone(phoneIn, store.country) : null;
  if (phoneIn && !phone) return fail("El teléfono no es válido. Usa el número con código de país, por ejemplo +504 9999 8888.");
  const emailIn = field(form, "email");
  const email = emailIn ? normalizeEmail(emailIn) : null;
  if (emailIn && !email) return fail("El correo no es válido. Ejemplo: tienda@gmail.com");
  if (!group && !phone && !email) return fail("Escribe el enlace del grupo, el teléfono del dueño o el correo de la tienda.");

  const patch = {
    whatsapp_group_url: group?.url ?? null,
    whatsapp_group_code: group?.code ?? null,
    owner_phone: phone,
    owner_name: field(form, "owner_name").slice(0, 120) || null,
    email,
    notes: field(form, "notes").slice(0, 1000) || null,
  };

  const { data: link } = await db()
    .from("store_contact_links")
    .select("contact_id")
    .eq("account_id", store.accountId)
    .eq("store_id", store.storeId)
    .maybeSingle();

  const [byGroup, byPhone] = await Promise.all([findBy("whatsapp_group_code", patch.whatsapp_group_code), findBy("owner_phone", phone)]);

  // la tienda ya tiene contacto: se edita, cuidando que el grupo o el teléfono no sean de otro
  if (link) {
    const other = [byGroup, byPhone].find((c) => c && c.id !== link.contact_id);
    if (other) {
      const what = other === byGroup ? "Ese grupo" : "Ese teléfono";
      return fail(`${what} ya está guardado en el contacto de ${await describe(other.id)}. Desvincula esta tienda y vincúlala a ese contacto.`);
    }
    const { error } = await db().from("store_contacts").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", link.contact_id);
    if (error) return fail(dup(error));
    return done("Contacto actualizado.");
  }

  // tienda sin contacto: si el grupo o el teléfono ya existen, se suma a ese contacto
  if (byGroup && byPhone && byGroup.id !== byPhone.id) {
    return fail("El grupo y el teléfono están guardados en contactos distintos. Revisa cuál corresponde a esta tienda.");
  }
  const existing = byGroup ?? byPhone;
  if (existing) {
    // completa lo que le falte al contacto existente, sin pisar lo que ya tiene
    const fill: Partial<StoreContact> = {};
    if (!existing.whatsapp_group_code && group && !byGroup) Object.assign(fill, { whatsapp_group_url: group.url, whatsapp_group_code: group.code });
    if (!existing.owner_phone && phone && !byPhone) fill.owner_phone = phone;
    if (!existing.owner_name && patch.owner_name) fill.owner_name = patch.owner_name;
    if (!existing.email && patch.email) fill.email = patch.email;
    if (!existing.notes && patch.notes) fill.notes = patch.notes;
    if (Object.keys(fill).length) {
      const { error } = await db().from("store_contacts").update({ ...fill, updated_at: new Date().toISOString() }).eq("id", existing.id);
      if (error) return fail(dup(error));
    }
    const other = await describe(existing.id);
    const { error } = await db().from("store_contact_links").insert({
      account_id: store.accountId, store_id: store.storeId, contact_id: existing.id, store_name: store.storeName,
    });
    if (error) return fail(dup(error));
    return done(`${byGroup ? "Ese grupo" : "Ese teléfono"} ya estaba guardado para ${other}: esta tienda quedó vinculada al mismo contacto.`);
  }

  const { data: created, error } = await db().from("store_contacts").insert(patch).select("id").single();
  if (error || !created) return fail(dup(error ?? { message: "sin respuesta" }));
  const res = await db().from("store_contact_links").insert({
    account_id: store.accountId, store_id: store.storeId, contact_id: created.id, store_name: store.storeName,
  });
  if (res.error) {
    await db().from("store_contacts").delete().eq("id", created.id);
    return fail(dup(res.error));
  }
  return done("Contacto guardado.");
}

/** Vincula una tienda (esta u otra operación) a un contacto existente. */
export async function linkStore(_prev: ContactState, form: FormData): Promise<ContactState> {
  const auth = await authorizeAction("stores_edit");
  if (!auth.ok) return fail(auth.msg);
  const contactId = field(form, "contact_id");
  const store = await storeOf(form);
  if (!UUID.test(contactId) || !store) return fail("Datos no válidos.");
  const { data: contact } = await db().from("store_contacts").select("id").eq("id", contactId).maybeSingle();
  if (!contact) return fail("Contacto no encontrado.");
  const { data: link } = await db()
    .from("store_contact_links")
    .select("contact_id")
    .eq("account_id", store.accountId)
    .eq("store_id", store.storeId)
    .maybeSingle();
  if (link) return fail(link.contact_id === contactId ? "Ya estaba vinculada." : "Esa tienda ya tiene otro contacto. Desvincúlala primero desde su ficha.");
  const { error } = await db().from("store_contact_links").insert({
    account_id: store.accountId, store_id: store.storeId, contact_id: contactId, store_name: store.storeName,
  });
  if (error) return fail(dup(error));
  return done("Tienda vinculada al contacto.");
}

/** Quita una tienda de su contacto; si el contacto queda sin tiendas, se borra. */
export async function unlinkStore(_prev: ContactState, form: FormData): Promise<ContactState> {
  const auth = await authorizeAction("stores_edit");
  if (!auth.ok) return fail(auth.msg);
  const contactId = field(form, "contact_id");
  const store = await storeOf(form);
  if (!UUID.test(contactId) || !store) return fail("Datos no válidos.");
  const { error } = await db()
    .from("store_contact_links")
    .delete()
    .eq("account_id", store.accountId)
    .eq("store_id", store.storeId)
    .eq("contact_id", contactId);
  if (error) return fail(`No se pudo desvincular: ${error.message}`);
  const { data: rest } = await db().from("store_contact_links").select("store_id").eq("contact_id", contactId).limit(1);
  if (!rest?.length) await db().from("store_contacts").delete().eq("id", contactId);
  return done("Tienda desvinculada.");
}
