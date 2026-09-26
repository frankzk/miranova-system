"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isLoggedIn } from "@/lib/auth";
import { getAccount, updateAccount } from "@/lib/accounts";
import { countryByCode, PLATFORMS } from "@/lib/countries";
import { encrypt } from "@/lib/crypto";
import { parseTotpSecret } from "@/lib/totp";
import { db } from "@/lib/supabase";
import { reprocessAll } from "@/lib/store";
import { syncAccount } from "@/lib/sync";

async function guard() {
  if (!(await isLoggedIn())) redirect("/login");
}

function back(msg: string, ok: boolean): never {
  revalidatePath("/", "layout");
  redirect(`/settings?${new URLSearchParams({ msg, ok: ok ? "1" : "0" })}`);
}

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Lee la clave 2FA del formulario: null si viene vacía; corta con error si no es válida. */
function totpField(f: FormData): string | null {
  const raw = field(f, "totp");
  if (!raw) return null;
  const secret = parseTotpSecret(raw);
  if (!secret) {
    back(/^\d{6}$/.test(raw)
      ? "Eso es un código de 6 dígitos (caduca en 30 s). Pega la clave secreta del 2FA: el texto largo de letras y números que aparece junto al QR."
      : "La clave 2FA no es válida: debe ser el texto de letras A-Z y números 2-7 que aparece junto al QR (o el enlace otpauth://).", false);
  }
  return secret;
}

export async function createAccount(form: FormData) {
  await guard();
  const platform = field(form, "platform");
  const country = countryByCode(field(form, "country"));
  const email = field(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  const p = PLATFORMS.find((x) => x.id === platform);
  if (!p || !country || !email || !password) back("Completa plataforma, país, correo y contraseña.", false);
  const totp = totpField(form);

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
      totp_secret_enc: totp ? encrypt(totp) : null,
      enabled: p.ready,
      // tras lo reciente, cargar el historial hacia atrás en las siguientes sincronizaciones
      backfill_cursor: new Date(Date.now() - 45 * 86_400_000).toISOString(),
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
  const totp = totpField(form);
  const clearTotp = form.get("clear_totp") === "on";
  if (!password && !email && !totp && !clearTotp) back("Nada que actualizar.", false);
  const patch: Record<string, unknown> = { session_enc: null };
  if (email) patch.login_email = email;
  if (password) patch.password_enc = encrypt(password);
  if (totp) patch.totp_secret_enc = encrypt(totp);
  else if (clearTotp) patch.totp_secret_enc = null;
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
  back("Cuenta y sus órdenes eliminadas.", true);
}

export async function loadHistory(form: FormData) {
  await guard();
  const id = field(form, "id");
  await updateAccount(id, { backfill_cursor: new Date(Date.now() - 45 * 86_400_000).toISOString() });
  const r = await syncAccount(id);
  back(r.message, r.ok);
}

export async function reprocess() {
  await guard();
  const n = await reprocessAll();
  back(`Se volvieron a leer ${n.toLocaleString("en-US")} órdenes con el formato actual.`, true);
}
