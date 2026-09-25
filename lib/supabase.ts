import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Cliente con service role: solo se usa en el servidor, nunca en el navegador. */
export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}
