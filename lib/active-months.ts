// Tiendas activas por mes (Inicio): qué meses mostrar y cómo nombrarlos. Puro, para poder probarlo.

export type ActiveMonth = { k: number; month: string; active: number; new: number; orders: number };

/** Quita los meses vacíos del principio (antes de que la cuenta tuviera pedidos); los del medio se quedan. */
export function visibleMonths(months: ActiveMonth[] | null | undefined): ActiveMonth[] {
  const list = months ?? [];
  const first = list.findIndex((m) => m.active > 0 || m.orders > 0);
  return first === -1 ? [] : list.slice(first);
}

const fmt = (ym: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("es", { ...opts, timeZone: "UTC" }).format(new Date(`${ym}-01T12:00:00Z`)).replace(/\./g, "");

/** "sept", o "dic 25" si no es del año del mes en curso. */
export function monthShort(ym: string, currentYm: string): string {
  const m = fmt(ym, { month: "short" });
  return ym.slice(0, 4) === currentYm.slice(0, 4) ? m : `${m} ${ym.slice(2, 4)}`;
}

/** "septiembre 2026". */
export const monthLong = (ym: string) => fmt(ym, { month: "long", year: "numeric" }).replace(" de ", " ");
