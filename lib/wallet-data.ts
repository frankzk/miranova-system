import "server-only";
import { connectorFor } from "./connectors";
import { db } from "./supabase";
import { toUsd } from "./wallet";

export type WalletRow = {
  account_id: string;
  name: string;
  currency: string;
  balance: number | null;
  usd: number | null;
  /** Cuándo se leyó el saldo (sincronización). */
  at: string | null;
  /** Por qué no hay saldo (o por qué no se actualizó). */
  msg: string | null;
};

const hasWallet = (platform: string, country: string) => {
  try {
    return Boolean(connectorFor(platform, country).fetchWallet);
  } catch {
    return false;
  }
};

/** Saldo de la billetera de cada cuenta de proveedor activa (no las de dropshipper que solo espían el catálogo). */
export async function walletBalances(account?: string): Promise<WalletRow[]> {
  let q = db()
    .from("accounts")
    .select("id, name, platform, country, currency, catalog_only, wallet_balance, wallet_at, wallet_msg, created_at")
    .eq("enabled", true)
    .order("created_at");
  if (account) q = q.eq("id", account);
  const [{ data, error }, fx] = await Promise.all([q, db().from("account_fx").select("account_id, usd_rate")]);
  if (error) throw error;
  const rate = new Map(((fx.data ?? []) as { account_id: string; usd_rate: number | null }[]).map((r) => [r.account_id, r.usd_rate === null ? null : Number(r.usd_rate)]));

  return (data as {
    id: string; name: string; platform: string; country: string; currency: string; catalog_only: boolean | null;
    wallet_balance: number | null; wallet_at: string | null; wallet_msg: string | null;
  }[])
    .filter((a) => !a.catalog_only && hasWallet(a.platform, a.country))
    .map((a) => {
      const balance = a.wallet_balance == null ? null : Number(a.wallet_balance);
      return {
        account_id: a.id,
        name: a.name,
        currency: a.currency,
        balance,
        usd: balance === null ? null : toUsd(balance, a.currency, rate.get(a.id) ?? null),
        at: a.wallet_at,
        msg: a.wallet_msg,
      };
    });
}
