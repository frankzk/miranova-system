import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Lee una variable de entorno aceptando el prefijo que añade la integración
 * de Supabase en Vercel (p. ej. STORAGE_SUPABASE_URL en vez de SUPABASE_URL).
 */
function env(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  const key = Object.keys(process.env).find((k) => k.endsWith(`_${name}`) && process.env[k]);
  return key ? process.env[key] : undefined;
}

/** Cliente con service role: solo se usa en el servidor, nunca en el navegador. */
export function db(): SupabaseClient {
  if (client) return client;
  const url = env("SUPABASE_URL") ?? env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") ?? env("SUPABASE_SECRET_KEY");
  if (!url || !key) throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}
