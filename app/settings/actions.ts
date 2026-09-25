"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isLoggedIn } from "@/lib/auth";
import { getAccount, updateAccount } from "@/lib/accounts";
import { countryByCode, PLATFORMS } from "@/lib/countries";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/supabase";
import { syncAccount } from "@/lib/sync";

async function guard() {
  if (!(await isLoggedIn())) redirect("/login");
}

function back(msg: string, ok: boolean): never {
  revalidatePath("/settings");
  redirect(`/settings?${new URLSearchParams({ msg, ok: ok ? "1" : "0" })}`);
}

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function createAccount(form: FormData) {
  await guard();
  const platform = field(form, "platform");
  const country = countryByCode(field(form, "country"));
  const email = field(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  const p = PLATFORMS.find((x) => x.id === platform);
  if (!p || !country || !email || !password) back("Completa plataforma, país, correo y contraseña.", false);

  const name = field(form, "name") || `${p.id === "soydrop" ? "Drop" : "Dropi"} ${country.name}`;

  // evita duplicados (p. ej. doble clic): misma plataforma + correo + país
  const dup = await db()
    .from("accounts")
    .select("name")
    .eq("platform", platform)
    .eq("login_email", email)
    .eq("country", country.code)
    .limit(1);
  if (dup.data?.length) {
    back(`Ya existe "${dup.data[0].name}" con ese correo y país. Si ese correo tiene varias cuentas en el mismo país, elige otro nombre y cámbiala en "Cuenta dentro de este correo".`, false);
  }
  const { data, error } = await db()
    .from("accounts")
    .insert({
      name,
      platform,
      country: country.code,
      currency: country.currency,
      timezone: country.timezone,
      login_email: email,
      password_enc: encrypt(password),
      enabled: p.ready,
    })
    .select("id")
    .single();
  if (error) back(`No se pudo guardar: ${error.message}`, false);

  if (!p.ready) back(`${name} guardada. ${p.name} se sincronizará cuando esté lista la integración.`, true);

  const r = await syncAccount(data.id);
  back(r.ok ? `${name} conectada: ${r.message}.` : `${name} guardada, pero: ${r.message}`, r.ok);
}

export async function syncNow(form: FormData) {
  await guard();
  const id = field(form, "id");
  const acc = await getAccount(id);
  if (!acc) back("Cuenta no encontrada.", false);
  const r = await syncAccount(id);
  back(`${acc.name}: ${r.message}`, r.ok);
}

export async function chooseRef(form: FormData) {
  await guard();
  const id = field(form, "id");
  const ref = field(form, "ref");
  const acc = await getAccount(id);
  if (!acc || !ref) back("Elige una cuenta.", false);
  const name = acc.debug?.available_accounts?.find((a) => a.ref === ref)?.name ?? null;
  // al cambiar de cuenta, la sesión y la ruta anteriores ya no sirven
  await updateAccount(id, { platform_ref: ref, platform_ref_name: name, session_enc: null, orders_path: null });
  const r = await syncAccount(id);
  back(`${acc.name}: ${r.message}`, r.ok);
}

export async function updatePassword(form: FormData) {
  await guard();
  const id = field(form, "id");
  const email = field(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!password && !email) back("Nada que actualizar.", false);
  const patch: Record<string, unknown> = { session_enc: null };
  if (email) patch.login_email = email;
  if (password) patch.password_enc = encrypt(password);
  await updateAccount(id, patch);
  const r = await syncAccount(id);
  back(`Datos de acceso actualizados. ${r.message}`, r.ok);
}

export async function toggleAccount(form: FormData) {
  await guard();
  const id = field(form, "id");
  const acc = await getAccount(id);
  if (!acc) back("Cuenta no encontrada.", false);
  await updateAccount(id, { enabled: !acc.enabled });
  back(`${acc.name} ${acc.enabled ? "pausada" : "activada"}.`, true);
}

export async function resetDiscovery(form: FormData) {
  await guard();
  const id = field(form, "id");
  await updateAccount(id, { orders_path: null, session_enc: null });
  const r = await syncAccount(id);
  back(r.message, r.ok);
}

export async function deleteAccount(form: FormData) {
  await guard();
  const id = field(form, "id");
  if (field(form, "confirm") !== "ELIMINAR") back("Escribe ELIMINAR para confirmar.", false);
  const { error } = await db().from("accounts").delete().eq("id", id);
  if (error) back(error.message, false);
  back("Cuenta y sus pedidos eliminados.", true);
}
