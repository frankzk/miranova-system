import "server-only";
import { decrypt, encrypt } from "./crypto";
import { appPassword, type PanelEmail } from "./email-config";
import { db } from "./supabase";

// Ajustes → Correo: cuenta de Gmail que envía (contraseña de aplicación cifrada con ENCRYPTION_KEY,
// igual que las contraseñas de las plataformas) y a quién le llega el resumen diario.
// Tabla app_settings, clave "email" (migración 0028).

const KEY = "email";
type Stored = { gmail_user?: string | null; gmail_app_password?: string | null; digest_to?: string[] };

const missingTable = (e: { code?: string }) => e.code === "42P01" || e.code === "PGRST205";

async function stored(): Promise<Stored | null> {
  const { data, error } = await db().from("app_settings").select("value").eq("key", KEY).maybeSingle();
  if (error) {
    if (missingTable(error)) return null;
    throw error;
  }
  return data ? ((data.value ?? {}) as Stored) : null;
}

export async function loadPanelEmail(): Promise<PanelEmail | null> {
  const v = await stored();
  if (!v) return null;
  let pass: string | null = null;
  if (v.gmail_app_password) {
    try {
      pass = decrypt(v.gmail_app_password);
    } catch {
      pass = null; // otra ENCRYPTION_KEY: hay que volver a escribirla
    }
  }
  return { gmailUser: v.gmail_user || null, gmailAppPassword: pass, digestTo: Array.isArray(v.digest_to) ? v.digest_to : [] };
}

/**
 * Guarda los ajustes. `newPassword` vacío conserva la contraseña guardada; sin correo que envía,
 * se borra también la contraseña.
 */
export async function savePanelEmail(next: { gmailUser: string | null; newPassword: string; digestTo: string[] }, userId: string): Promise<string | null> {
  const prev = await stored();
  const pass = !next.gmailUser ? null : next.newPassword ? encrypt(appPassword(next.newPassword)) : prev?.gmail_app_password ?? null;
  const value: Stored = { gmail_user: next.gmailUser, gmail_app_password: pass, digest_to: next.digestTo };
  // borrar e insertar: lo mismo que un upsert, y funciona igual con los datos de prueba
  const del = await db().from("app_settings").delete().eq("key", KEY);
  if (del.error) return del.error.message;
  const { error } = await db().from("app_settings").insert({ key: KEY, value, updated_by: userId, updated_at: new Date().toISOString() });
  return error ? error.message : null;
}
