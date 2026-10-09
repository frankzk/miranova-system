// "Tiendas nuevas": cuándo entró cada tienda a vender con Miranova (su primer pedido), con el
// dueño, el nombre y el correo, para cotejar referidos. Puro, para poder probarlo.

import { customDays } from "./ranges.ts";
import { norm, storeEmail } from "./store-contacts.ts";

export type Signup = {
  account_id: string;
  store_id: string;
  account_name: string;
  name: string;
  person: string | null;
  /** Primer pedido no cancelado (ISO). */
  first_at: string;
  email: string | null;
};

export type SignupRow<T extends Signup = Signup> = T & {
  /** De dónde sale el correo: el contacto (cargado a mano) o los pedidos. */
  emailSource: "contacto" | "pedidos" | null;
  /** Dueño anotado en el contacto, solo si es distinto del de Drop. */
  contactOwner: string | null;
};

/**
 * Junta cada tienda con su contacto: el correo del contacto gana al detectado en los pedidos y,
 * si Drop no trae el dueño, se usa el del contacto.
 */
export function toSignups<T extends Signup>(
  profiles: T[],
  contactOf: (p: T) => { email?: string | null; owner_name?: string | null } | undefined,
): SignupRow<T>[] {
  return profiles.map((p) => {
    const c = contactOf(p);
    const mail = storeEmail(c?.email, p.email);
    const owner = c?.owner_name?.trim() || null;
    return {
      ...p,
      person: p.person || owner,
      email: mail?.email ?? null,
      emailSource: mail?.source ?? null,
      contactOwner: owner && p.person && norm(owner) !== norm(p.person) ? owner : null,
    };
  });
}

/** Solo las tiendas que ya entraron: con algún pedido no cancelado (la misma regla de Inicio). */
export function entered<T extends { first_at: string | null }>(rows: T[]): (T & { first_at: string })[] {
  return rows.filter((r): r is T & { first_at: string } => !!r.first_at);
}

/** Fecha local (YYYY-MM-DD) de un instante en la zona dada. */
export const localDay = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));

/** Primer y último día (YYYY-MM-DD) del mes de `day`, o del mes anterior con `offset = -1`. */
export function monthBounds(day: string, offset = 0): { from: string; to: string } {
  const [y, m] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offset, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/**
 * Tiendas que entraron entre `from` y `to` (días locales de su cuenta, inclusive), que coinciden
 * con la búsqueda (tienda, dueño o correo), de la más reciente a la más antigua.
 */
export function filterSignups<T extends Signup>(
  rows: T[],
  f: { from?: string | null; to?: string | null; q?: string | null },
  tzOf: (accountId: string) => string,
): T[] {
  const words = norm(f.q ?? "").split(" ").filter(Boolean);
  return rows
    .filter((r) => {
      const d = localDay(r.first_at, tzOf(r.account_id));
      if (f.from && d < f.from) return false;
      if (f.to && d > f.to) return false;
      if (!words.length) return true;
      const hay = norm(`${r.name} ${r.person ?? ""} ${r.email ?? ""}`);
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => b.first_at.localeCompare(a.first_at) || a.name.localeCompare(b.name, "es"));
}

export const SIGNUP_PERIODS = { todas: "Todas", mes: "Este mes", anterior: "Mes anterior" } as const;
export type SignupPeriod = keyof typeof SIGNUP_PERIODS;

/** Días del período (null = todas). */
export function periodBounds(p: SignupPeriod, today: string): { from: string; to: string } | null {
  return p === "mes" ? monthBounds(today) : p === "anterior" ? monthBounds(today, -1) : null;
}

/** Período de la URL: un rango propio (from/to) gana; si no, `p` (mes, anterior) o todas. */
export function signupPeriod(
  sp: { p?: string; from?: string; to?: string },
  today: string,
): { period: SignupPeriod | "rango"; custom: { from: string; to: string } | null; bounds: { from: string; to: string } | null } {
  const custom = customDays(sp.from, sp.to, today);
  if (custom) return { period: "rango", custom, bounds: custom };
  const period: SignupPeriod = sp.p === "mes" || sp.p === "anterior" ? sp.p : "todas";
  return { period, custom: null, bounds: periodBounds(period, today) };
}
