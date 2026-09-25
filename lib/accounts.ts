import "server-only";
import { db } from "./supabase";

export type Account = {
  id: string;
  name: string;
  platform: string;
  country: string;
  currency: string;
  timezone: string;
  login_email: string;
  password_enc: string;
  platform_ref: string | null;
  platform_ref_name: string | null;
  session_enc: string | null;
  orders_path: string | null;
  enabled: boolean;
  last_sync_at: string | null;
  last_sync_ok: boolean | null;
  last_sync_msg: string | null;
  debug: {
    available_accounts?: { ref: string; name: string }[];
    probe?: unknown;
    [k: string]: unknown;
  } | null;
  created_at: string;
};

/** Datos seguros para mostrar en el panel (sin contraseña ni sesión). */
export type AccountView = Omit<Account, "password_enc" | "session_enc"> & { order_count: number };

export async function listAccounts(): Promise<AccountView[]> {
  const { data, error } = await db()
    .from("accounts")
    .select("*, orders(count)")
    .order("created_at");
  if (error) throw error;
  return data.map(({ password_enc: _p, session_enc: _s, orders, ...a }) => ({
    ...a,
    order_count: (orders as { count: number }[])?.[0]?.count ?? 0,
  })) as AccountView[];
}

export async function getAccount(id: string): Promise<Account | null> {
  const { data, error } = await db().from("accounts").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Account | null;
}

export async function updateAccount(id: string, patch: Partial<Account>): Promise<void> {
  const { error } = await db()
    .from("accounts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function accountNames(): Promise<{ id: string; name: string; currency: string }[]> {
  const { data, error } = await db().from("accounts").select("id, name, currency").order("name");
  if (error) throw error;
  return data;
}
