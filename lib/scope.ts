import "server-only";
import { cookies } from "next/headers";
import type { AccountSummary } from "./accounts";
import { DEFAULT_TZ } from "./format";

export const SCOPE_COOKIE = "mn_scope";

export type Scope = {
  /** id de la cuenta elegida, o undefined = todas */
  account?: string;
  current: AccountSummary | null;
  tz: string;
  label: string;
};

/** Cuenta activa (selector de la barra lateral), validada contra las cuentas existentes. */
export async function getScope(accounts: AccountSummary[]): Promise<Scope> {
  const id = (await cookies()).get(SCOPE_COOKIE)?.value;
  const current = accounts.find((a) => a.id === id) ?? null;
  return {
    account: current?.id,
    current,
    tz: current?.timezone ?? accounts[0]?.timezone ?? DEFAULT_TZ,
    label: current?.name ?? "Todas las cuentas",
  };
}
