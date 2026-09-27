import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { makeSessionToken, readSessionToken, safeEqual, SESSION_COOKIE } from "./passwords";
import { can, permissionLabel, type Permission } from "./permissions";
import { db } from "./supabase";

// Capa de acceso del panel: quién es el usuario de esta petición y qué puede hacer.
// Cada página, acción y ruta de API lo verifica por su cuenta (el layout no protege a sus
// páginas en la navegación del lado del cliente ni a las acciones del servidor).

export { SESSION_COOKIE } from "./passwords";

export type SessionUser = {
  id: string;
  username: string;
  name: string;
  permissions: string[];
  is_owner: boolean;
  must_change_password: boolean;
};

const USER_FIELDS = "id, username, name, permissions, is_owner, active, must_change_password, session_version";

/** Usuario de la sesión (una consulta por petición); null si no hay sesión válida. */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const s = readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return null;
  const { data, error } = await db().from("app_users").select(USER_FIELDS).eq("id", s.userId).maybeSingle();
  if (error || !data || !data.active || data.session_version !== s.version) return null;
  return {
    id: data.id,
    username: data.username,
    name: data.name,
    permissions: data.permissions ?? [],
    is_owner: !!data.is_owner,
    must_change_password: !!data.must_change_password,
  };
});

/** Páginas: exige sesión (y que ya haya cambiado la contraseña temporal). */
export async function requireUser(opts: { allowPasswordChange?: boolean } = {}): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect("/login");
  if (u.must_change_password && !opts.allowPasswordChange) redirect("/account?first=1");
  return u;
}

/** Páginas: exige un permiso; sin él, lleva a la página "Sin acceso". */
export async function requirePermission(p: Permission): Promise<SessionUser> {
  const u = await requireUser();
  if (!can(u, p)) redirect(`/sin-acceso?p=${p}`);
  return u;
}

export type ActionAuth = { ok: true; user: SessionUser } | { ok: false; msg: string };

/** Acciones del servidor: el usuario si tiene el permiso; si no, el mensaje para mostrar. */
export async function authorizeAction(p?: Permission): Promise<ActionAuth> {
  const u = await currentUser();
  if (!u) return { ok: false, msg: "Tu sesión expiró. Vuelve a entrar." };
  if (u.must_change_password) return { ok: false, msg: "Primero cambia tu contraseña temporal en Mi cuenta." };
  if (p && !can(u, p)) return { ok: false, msg: `No tienes permiso de ${permissionLabel(p)} para hacer esto.` };
  return { ok: true, user: u };
}

/** Rutas de API: el usuario, o la respuesta 401/403 que hay que devolver. */
export async function authorizeRoute(...perms: Permission[]): Promise<SessionUser | Response> {
  const u = await currentUser();
  if (!u || u.must_change_password) return Response.json({ error: "No autorizado" }, { status: 401 });
  const missing = perms.find((p) => !can(u, p));
  if (missing) return Response.json({ error: `Sin permiso de ${permissionLabel(missing)}` }, { status: 403 });
  return u;
}

/** Cookie de sesión para el usuario (misma configuración en login y al cambiar la contraseña). */
export function sessionCookie(userId: string, version: number) {
  const { value, maxAge } = makeSessionToken(userId, version);
  return {
    name: SESSION_COOKIE,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

/** Valida la API key que usa la extensión de Chrome. */
export function isValidIngestKey(key: string | null): boolean {
  const expected = process.env.INGEST_API_KEY;
  return !!expected && !!key && safeEqual(key, expected);
}

export { safeNext } from "./permissions";
