import "server-only";
import { decrypt, encrypt } from "./crypto";
import { db } from "./supabase";

// Ajustes → Integraciones: claves de servicios externos, cifradas con ENCRYPTION_KEY (como la
// contraseña de Gmail). Tabla app_settings, clave "integrations". Si no hay clave guardada en el
// panel, se usa la de Vercel (TRACK17_API_KEY / ANTHROPIC_API_KEY).

const KEY = "integrations";
export type IntegrationName = "track17" | "anthropic";
type Stored = Partial<Record<IntegrationName, string | null>>;

const ENV: Record<IntegrationName, string> = { track17: "TRACK17_API_KEY", anthropic: "ANTHROPIC_API_KEY" };
const missingTable = (e: { code?: string }) => e.code === "42P01" || e.code === "PGRST205";

async function stored(): Promise<Stored> {
  const { data, error } = await db().from("app_settings").select("value").eq("key", KEY).maybeSingle();
  if (error) {
    if (missingTable(error)) return {};
    throw error;
  }
  return ((data?.value ?? {}) as Stored) ?? {};
}

function open(v: string | null | undefined): string | null {
  if (!v) return null;
  try {
    return decrypt(v);
  } catch {
    return null; // otra ENCRYPTION_KEY: hay que volver a escribirla
  }
}

/** La clave de un servicio: la del panel o, si no hay, la de Vercel. */
export async function integrationKey(name: IntegrationName): Promise<string | null> {
  const panel = open((await stored())[name]);
  return panel || process.env[ENV[name]]?.trim() || null;
}

/** Para Ajustes: si hay clave, de dónde viene y sus últimos 4 caracteres (nunca la clave completa). */
export async function integrationStatus(): Promise<Record<IntegrationName, { source: "panel" | "vercel" | null; tail: string | null }>> {
  const s = await stored();
  const one = (name: IntegrationName) => {
    const panel = open(s[name]);
    const env = process.env[ENV[name]]?.trim() || null;
    const key = panel || env;
    return { source: panel ? ("panel" as const) : env ? ("vercel" as const) : null, tail: key ? key.slice(-4) : null };
  };
  return { track17: one("track17"), anthropic: one("anthropic") };
}

/** Guarda las claves: vacío conserva la guardada; `clear` la borra. */
export async function saveIntegrations(next: Partial<Record<IntegrationName, { key: string; clear: boolean }>>, userId: string): Promise<string | null> {
  const prev = await stored();
  const value: Stored = { ...prev };
  for (const name of Object.keys(next) as IntegrationName[]) {
    const n = next[name]!;
    if (n.clear) value[name] = null;
    else if (n.key) value[name] = encrypt(n.key);
  }
  const del = await db().from("app_settings").delete().eq("key", KEY);
  if (del.error) return del.error.message;
  const { error } = await db().from("app_settings").insert({ key: KEY, value, updated_by: userId, updated_at: new Date().toISOString() });
  return error ? error.message : null;
}
