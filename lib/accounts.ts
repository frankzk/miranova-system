import "server-only";
import { cache } from "react";
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
  totp_secret_enc: string | null;
  platform_ref: string | null;
  platform_ref_name: string | null;
  session_enc: string | null;
  orders_path: string | null;
  geo: { map: Record<string, string>; at: string } | null;
  backfill_cursor: string | null;
  open_refresh_at: string | null;
  products_path: string | null;
  products_sync_at: string | null;
  products_sync_msg: string | null;
  // Cuenta de dropshipper usada solo para espiar el catálogo de la competencia.
  catalog_only: boolean;
  catalog_path: string | null;
  catalog_sync_at: string | null;
  catalog_sync_msg: string | null;
  // Billetera del proveedor: ruta descubierta en la API, último saldo leído y cuándo.
  wallet_path: string | null;
  wallet_balance: number | null;
  wallet_at: string | null;
  wallet_msg: string | null;
  wallet_probe_at: string | null;
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
export type AccountView = Omit<Account, "password_enc" | "session_enc" | "geo" | "totp_secret_enc"> & { order_count: number; has_totp: boolean };

/** Lo que usan las secciones del panel (selector de cuenta, zona horaria, moneda, estado de sincronización). */
export type AccountSummary = Pick<AccountView,
  | "id" | "name" | "platform" | "country" | "currency" | "timezone" | "platform_ref" | "platform_ref_name" | "orders_path"
  | "backfill_cursor" | "products_path" | "products_sync_at" | "products_sync_msg" | "catalog_only" | "catalog_path"
  | "catalog_sync_at" | "catalog_sync_msg" | "enabled" | "last_sync_at" | "last_sync_ok" | "last_sync_msg" | "created_at">;

const SUMMARY_FIELDS =
  "id, name, platform, country, currency, timezone, platform_ref, platform_ref_name, orders_path, backfill_cursor, products_path, products_sync_at, products_sync_msg, catalog_only, catalog_path, catalog_sync_at, catalog_sync_msg, enabled, last_sync_at, last_sync_ok, last_sync_msg, created_at";

/**
 * Cuentas para las secciones del panel: una consulta por petición (el layout y la página la
 * comparten) y sin el conteo de órdenes ni el diagnóstico, que solo usa Ajustes.
 */
export const listAccounts = cache(async (): Promise<AccountSummary[]> => {
  const { data, error } = await db().from("accounts").select(SUMMARY_FIELDS).order("created_at");
  if (error) throw error;
  return data as AccountSummary[];
});

/** Ajustes → Cuentas: todo, con el conteo de órdenes y el diagnóstico de cada cuenta. */
export async function listAccountsFull(): Promise<AccountView[]> {
  const { data, error } = await db()
    .from("accounts")
    .select(`${SUMMARY_FIELDS}, login_email, totp_secret_enc, debug, orders(count)`)
    .order("created_at");
  if (error) throw error;
  return data.map(({ orders, totp_secret_enc, ...a }) => ({
    ...a,
    has_totp: Boolean(totp_secret_enc),
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
