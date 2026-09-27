import "server-only";
import { dummyHash, hashPassword, verifyPassword } from "./passwords";
import { db } from "./supabase";

// Usuarios del panel (tabla app_users, migración 0021): login con bloqueo por intentos
// fallidos y administración. Nunca devuelve password_hash fuera de este archivo.

export type AppUser = {
  id: string;
  username: string;
  name: string;
  permissions: string[];
  is_owner: boolean;
  active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
};

const PUBLIC_FIELDS = "id, username, name, permissions, is_owner, active, must_change_password, last_login_at, created_at";

export const MAX_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

export async function userCount(): Promise<number> {
  const { count, error } = await db().from("app_users").select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function listUsers(): Promise<AppUser[]> {
  const { data, error } = await db().from("app_users").select(PUBLIC_FIELDS).order("is_owner", { ascending: false }).order("name");
  if (error) throw error;
  return (data ?? []) as AppUser[];
}

export async function getUser(id: string): Promise<AppUser | null> {
  const { data, error } = await db().from("app_users").select(PUBLIC_FIELDS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as AppUser | null) ?? null;
}

export async function activeOwnerCount(): Promise<number> {
  const { count, error } = await db().from("app_users").select("id", { count: "exact", head: true }).eq("is_owner", true).eq("active", true);
  if (error) throw error;
  return count ?? 0;
}

export type LoginResult =
  | { ok: true; user: { id: string; session_version: number; must_change_password: boolean } }
  | { ok: false; reason: "invalid" | "locked"; minutes?: number };

/**
 * Verifica usuario y contraseña. Tras MAX_ATTEMPTS fallos seguidos bloquea el usuario
 * LOCK_MINUTES minutos. Si el usuario no existe también calcula un hash, para tardar lo mismo.
 */
export async function checkLogin(username: string, password: string): Promise<LoginResult> {
  const { data: u } = await db()
    .from("app_users")
    .select("id, password_hash, active, failed_attempts, locked_until, session_version, must_change_password")
    .eq("username", username)
    .maybeSingle();
  if (!u) {
    await verifyPassword(password, await dummyHash());
    return { ok: false, reason: "invalid" };
  }
  const now = Date.now();
  if (u.locked_until && Date.parse(u.locked_until) > now) {
    return { ok: false, reason: "locked", minutes: Math.ceil((Date.parse(u.locked_until) - now) / 60_000) };
  }
  const good = await verifyPassword(password, u.password_hash);
  if (!good || !u.active) {
    if (!good) {
      const attempts = (u.failed_attempts ?? 0) + 1;
      const lock = attempts >= MAX_ATTEMPTS;
      await db()
        .from("app_users")
        .update({ failed_attempts: lock ? 0 : attempts, locked_until: lock ? new Date(now + LOCK_MINUTES * 60_000).toISOString() : null })
        .eq("id", u.id);
      if (lock) return { ok: false, reason: "locked", minutes: LOCK_MINUTES };
    }
    return { ok: false, reason: "invalid" };
  }
  await db().from("app_users").update({ failed_attempts: 0, locked_until: null, last_login_at: new Date(now).toISOString() }).eq("id", u.id);
  return { ok: true, user: { id: u.id, session_version: u.session_version, must_change_password: !!u.must_change_password } };
}

export type NewUser = {
  username: string;
  name: string;
  password: string;
  permissions: string[];
  is_owner?: boolean;
  must_change_password?: boolean;
  created_by?: string | null;
};

export async function createUser(u: NewUser): Promise<{ id: string } | { error: string }> {
  const { data, error } = await db()
    .from("app_users")
    .insert({
      username: u.username,
      name: u.name,
      password_hash: await hashPassword(u.password),
      permissions: u.permissions,
      is_owner: !!u.is_owner,
      must_change_password: !!u.must_change_password,
      created_by: u.created_by ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.code === "23505" ? "Ese usuario ya existe." : `No se pudo crear: ${error?.message ?? "sin respuesta"}` };
  return { id: data.id };
}

/** Cambia la contraseña y cierra las demás sesiones (sube session_version). Devuelve la versión nueva. */
export async function setPassword(id: string, password: string, mustChange: boolean): Promise<number | null> {
  const { data: cur } = await db().from("app_users").select("session_version").eq("id", id).maybeSingle();
  if (!cur) return null;
  const version = (cur.session_version ?? 1) + 1;
  const { error } = await db()
    .from("app_users")
    .update({
      password_hash: await hashPassword(password),
      must_change_password: mustChange,
      session_version: version,
      failed_attempts: 0,
      locked_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  return error ? null : version;
}

/** Verifica la contraseña actual de un usuario (para cambiarla desde Mi cuenta). */
export async function checkPassword(id: string, password: string): Promise<boolean> {
  const { data } = await db().from("app_users").select("password_hash").eq("id", id).maybeSingle();
  if (!data) return false;
  return verifyPassword(password, data.password_hash);
}

export async function updateUser(
  id: string,
  patch: Partial<Pick<AppUser, "name" | "permissions" | "active" | "is_owner">> & { bump_session?: boolean },
): Promise<string | null> {
  const { bump_session, ...rest } = patch;
  const row: Record<string, unknown> = { ...rest, updated_at: new Date().toISOString() };
  if (bump_session) {
    const { data: cur } = await db().from("app_users").select("session_version").eq("id", id).maybeSingle();
    if (!cur) return "Usuario no encontrado.";
    row.session_version = (cur.session_version ?? 1) + 1;
  }
  const { error } = await db().from("app_users").update(row).eq("id", id);
  return error ? `No se pudo guardar: ${error.message}` : null;
}

/** Cierra todas las sesiones de un usuario. */
export async function bumpSession(id: string): Promise<number | null> {
  const { data: cur } = await db().from("app_users").select("session_version").eq("id", id).maybeSingle();
  if (!cur) return null;
  const version = (cur.session_version ?? 1) + 1;
  const { error } = await db().from("app_users").update({ session_version: version }).eq("id", id);
  return error ? null : version;
}
