"use server";

import { revalidatePath } from "next/cache";
import { accessEmail } from "@/lib/access-email";
import { authorizeAction } from "@/lib/auth";
import { appUrl, sendEmail } from "@/lib/email";
import { isEmailAddress } from "@/lib/email-config";
import {
  can, isPermission, normalizePermissions, normalizeUsername, passwordProblem, PERMISSION_KEYS, USERNAME_RE, type Permission,
} from "@/lib/permissions";
import { activeOwnerCount, createUser, getUser, setPassword, updateUser } from "@/lib/users";

export type UserFormState = { ok: boolean; msg: string } | null;

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (msg: string): UserFormState => ({ ok: false, msg });
const done = (msg: string): UserFormState => {
  revalidatePath("/settings/users");
  return { ok: true, msg };
};

/**
 * Si se marcó "enviar por correo" y el usuario es un correo, le envía su acceso con la contraseña
 * temporal (Ajustes → Correo). Devuelve el texto que se suma al mensaje del formulario.
 */
async function mailAccess(form: FormData, kind: "new" | "reset", u: { name: string; username: string }, password: string): Promise<string> {
  if (form.get("send_email") !== "on") return "";
  if (!isEmailAddress(u.username)) return " No se envió por correo: su usuario no es un correo.";
  const mail = accessEmail({ kind, name: u.name, username: u.username, password, loginUrl: `${appUrl()}/login` });
  const r = await sendEmail({ to: [u.username], ...mail });
  return r.ok ? ` Le enviamos la contraseña a ${u.username}.` : ` No se pudo enviar el correo (${r.error}); compártesela tú.`;
}

/** Permisos marcados en el formulario (casillas "perm" con la clave como valor). */
const checked = (f: FormData) => normalizePermissions(f.getAll("perm").map(String).filter(isPermission));

/**
 * Permisos finales: los que el administrador puede otorgar se toman del formulario; los que no
 * puede (porque él no los tiene) se conservan como estaban, para que no los quite ni los dé.
 */
function merge(actor: { is_owner: boolean; permissions: readonly string[] }, requested: Permission[], current: readonly string[]): Permission[] {
  return normalizePermissions(PERMISSION_KEYS.filter((p) => (can(actor, p) ? requested.includes(p) : current.includes(p))));
}

export async function createUserAction(_prev: UserFormState, form: FormData): Promise<UserFormState> {
  const auth = await authorizeAction("users");
  if (!auth.ok) return fail(auth.msg);
  const actor = auth.user;

  const username = normalizeUsername(field(form, "username"));
  const name = field(form, "name").slice(0, 80);
  const password = String(form.get("password") ?? "");
  if (!name) return fail("Escribe el nombre.");
  if (!USERNAME_RE.test(username)) return fail("El usuario debe tener de 3 a 80 caracteres: letras minúsculas, números, punto, guion, guion bajo o un correo.");
  const weak = passwordProblem(password, username);
  if (weak) return fail(weak);

  const makeOwner = actor.is_owner && form.get("is_owner") === "on";
  const permissions = makeOwner ? PERMISSION_KEYS : merge(actor, checked(form), []);

  const r = await createUser({ username, name, password, permissions, is_owner: makeOwner, must_change_password: true, created_by: actor.id });
  if ("error" in r) return fail(r.error);
  const mailed = await mailAccess(form, "new", { name, username }, password);
  return done(`Usuario ${username} creado.${mailed || " Compártele su contraseña temporal: la cambiará al entrar."}`);
}

export async function updateUserAction(_prev: UserFormState, form: FormData): Promise<UserFormState> {
  const auth = await authorizeAction("users");
  if (!auth.ok) return fail(auth.msg);
  const actor = auth.user;

  const id = field(form, "id");
  if (!UUID.test(id)) return fail("Usuario no válido.");
  const target = await getUser(id);
  if (!target) return fail("Usuario no encontrado.");
  if (target.is_owner && !actor.is_owner) return fail("Solo un dueño puede editar a otro dueño.");

  const self = target.id === actor.id;
  const name = field(form, "name").slice(0, 80);
  if (!name) return fail("Escribe el nombre.");
  const active = form.get("active") === "on";
  const makeOwner = actor.is_owner ? form.get("is_owner") === "on" : target.is_owner;

  if (self && !active) return fail("No puedes desactivar tu propio usuario.");
  // siempre debe quedar al menos un dueño activo
  if (target.is_owner && target.active && (!makeOwner || !active) && (await activeOwnerCount()) <= 1) {
    return fail("Es el único dueño activo: marca a otro usuario como dueño antes de quitarle ese rol o desactivarlo.");
  }

  let permissions = makeOwner ? PERMISSION_KEYS : merge(actor, checked(form), target.permissions);
  // nadie se quita a sí mismo el permiso de Usuarios (quedaría sin poder deshacerlo)
  if (self && !makeOwner && !permissions.includes("users")) {
    return fail("No puedes quitarte tu propio permiso de Usuarios.");
  }
  permissions = normalizePermissions(permissions);

  const err = await updateUser(id, { name, permissions, active, is_owner: makeOwner });
  if (err) return fail(err);
  return done(active ? "Cambios guardados." : "Usuario desactivado: ya no puede entrar.");
}

export async function resetPasswordAction(_prev: UserFormState, form: FormData): Promise<UserFormState> {
  const auth = await authorizeAction("users");
  if (!auth.ok) return fail(auth.msg);
  const actor = auth.user;

  const id = field(form, "id");
  if (!UUID.test(id)) return fail("Usuario no válido.");
  const target = await getUser(id);
  if (!target) return fail("Usuario no encontrado.");
  if (target.id === actor.id) return fail("Tu propia contraseña se cambia en Mi cuenta.");
  if (target.is_owner && !actor.is_owner) return fail("Solo un dueño puede restablecer la contraseña de otro dueño.");

  const password = String(form.get("password") ?? "");
  const weak = passwordProblem(password, target.username);
  if (weak) return fail(weak);

  const v = await setPassword(id, password, true);
  if (v === null) return fail("No se pudo cambiar la contraseña.");
  const mailed = await mailAccess(form, "reset", target, password);
  return done(`Contraseña restablecida. ${target.name} deberá cambiarla al entrar; sus sesiones abiertas se cerraron.${mailed}`);
}
