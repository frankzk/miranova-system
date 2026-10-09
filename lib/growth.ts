// Inicio › Órdenes: crecimiento semana a semana y mes a mes (función order_growth, migración 0032).
// El período en curso se compara contra el mismo tramo del anterior, hasta el mismo día y hora.
// Puro, para poder probarlo.

export type GrowthWeek = { k: number; start: string; orders: number };
export type GrowthMonth = { k: number; month: string; orders: number };
/** Una tienda en el período en curso (cur) contra el mismo tramo del anterior (prev). */
export type StoreDelta = { account_id: string; store_id: string; account_name: string; name: string | null; cur: number; prev: number };
export type OrderGrowth = {
  /** Ahora en la zona de la cuenta: "YYYY-MM-DDTHH:MI". */
  now: string;
  /** 12 semanas (lunes a domingo), de la más antigua (k = 11) a la actual (k = 0). */
  weeks: GrowthWeek[];
  /** 12 meses calendario, del más antiguo (k = 11) al actual (k = 0). */
  months: GrowthMonth[];
  /** Órdenes de la semana pasada hasta el mismo día y hora de hoy. */
  week_prev_to_date: number;
  /** Órdenes del mes pasado hasta el mismo día y hora (o hasta su último día, si es más corto). */
  month_prev_to_date: number;
  /** Tiendas cuyo número cambió en el tramo (migración 0033); sumadas dan la diferencia total. */
  week_stores?: StoreDelta[];
  month_stores?: StoreDelta[];
};

/**
 * Qué tiendas explican el cambio: las que más subieron y más bajaron contra el mismo tramo, y
 * cuánto suman unas y otras (subidas + bajadas = diferencia total del período).
 */
export function drivers(rows: StoreDelta[] | null | undefined, top = 4) {
  const all = (rows ?? []).filter((r) => r.cur !== r.prev).map((r) => ({ ...r, diff: r.cur - r.prev }));
  const upAll = all.filter((r) => r.diff > 0).sort((a, b) => b.diff - a.diff || b.cur - a.cur);
  const downAll = all.filter((r) => r.diff < 0).sort((a, b) => a.diff - b.diff || b.prev - a.prev);
  const sum = (xs: { diff: number }[]) => xs.reduce((t, x) => t + x.diff, 0);
  return {
    up: upAll.slice(0, top),
    down: downAll.slice(0, top),
    upCount: upAll.length,
    upSum: sum(upAll),
    downCount: downAll.length,
    downSum: sum(downAll),
  };
}

/** Cambio relativo (0.12 = +12 %); null si no hay base para comparar. */
export const pctChange = (cur: number, prev: number): number | null => (prev > 0 ? (cur - prev) / prev : null);

/** Quita los períodos vacíos del principio (antes de que hubiera pedidos); los del medio se quedan. */
export function trimLeading<T extends { orders: number }>(list: T[] | null | undefined): T[] {
  const all = list ?? [];
  const first = all.findIndex((x) => x.orders > 0);
  return first === -1 ? [] : all.slice(first);
}

/** Lo que va del período en curso contra el mismo tramo del anterior, y el anterior completo. */
export function toDate(g: OrderGrowth, kind: "week" | "month") {
  const list = kind === "week" ? g.weeks : g.months;
  const current = list.find((x) => x.k === 0)?.orders ?? 0;
  const prevFull = list.find((x) => x.k === 1)?.orders ?? 0;
  const prev = kind === "week" ? g.week_prev_to_date : g.month_prev_to_date;
  return { current, prev, prevFull, change: pctChange(current, prev) };
}

const parts = (now: string) => {
  const [d, t = "00:00"] = now.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [h, min] = t.split(":").map(Number);
  return { y, m, day, h, min };
};

/** Días transcurridos del mes (con fracción) y días que tiene. */
export function monthProgress(now: string): { elapsed: number; days: number } {
  const { y, m, day, h, min } = parts(now);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { elapsed: day - 1 + (h * 60 + min) / 1440, days };
}

/** Cierre estimado del mes al ritmo actual; null en la primera semana (muy poco para estimar). */
export function monthProjection(g: OrderGrowth): number | null {
  const { elapsed, days } = monthProgress(g.now);
  if (elapsed < 7) return null;
  return Math.round((toDate(g, "month").current / elapsed) * days);
}

const fmt = (ymd: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("es", { ...opts, timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`)).replace(/\./g, "");

/** "11:10 a. m." */
export function clock(now: string): string {
  const { h, min } = parts(now);
  return `${h % 12 || 12}:${String(min).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
}

/** Tramo de la semana en curso: "lun a vie, hasta las 11:10 a. m." (o "el lunes, hasta…"). */
export function weekToDateLabel(now: string): string {
  const day = now.slice(0, 10);
  const wd = fmt(day, { weekday: "short" });
  const monday = new Date(`${day}T12:00:00Z`).getUTCDay() === 1;
  return `${monday ? `el ${fmt(day, { weekday: "long" })}` : `lun a ${wd}`}, hasta las ${clock(now)}`;
}

/** Tramos del mes en curso y del anterior: { current: "1–9 oct", prev: "1–9 sept" }. */
export function monthToDateLabels(now: string): { current: string; prev: string } {
  const { y, m, day } = parts(now);
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const prevDays = new Date(Date.UTC(prevY, prevM, 0)).getUTCDate();
  const iso = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-01`;
  const span = (d: number, ym: string) => `${d === 1 ? "1" : `1–${d}`} ${fmt(ym, { month: "short" })}`;
  return { current: span(day, iso(y, m)), prev: span(Math.min(day, prevDays), iso(prevY, prevM)) };
}

/** "29 sept – 5 oct" (lunes a domingo). */
export function weekRange(start: string): string {
  const end = new Date(Date.parse(`${start}T12:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  const a = fmt(start, { day: "numeric", month: "short" });
  const b = fmt(end, { day: "numeric", month: "short" });
  return start.slice(5, 7) === end.slice(5, 7) ? `${a.split(" ")[0]} – ${b}` : `${a} – ${b}`;
}

/** "20 jul". */
export const dayMonth = (ymd: string) => fmt(ymd, { day: "numeric", month: "short" });

/** "oct", o "dic 25" si no es del año en curso. */
export function monthShort(ym: string, now: string): string {
  const m = fmt(`${ym}-01`, { month: "short" });
  return ym.slice(0, 4) === now.slice(0, 4) ? m : `${m} ${ym.slice(2, 4)}`;
}

/** "septiembre". */
export const monthName = (ym: string) => fmt(`${ym}-01`, { month: "long" });
