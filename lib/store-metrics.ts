// Ficha de tienda: tipos de la función SQL `store_detail` y cálculos puros (sin servidor),
// para poder probarlos y usarlos también en componentes de cliente.

export type StoreDay = { day: string; orders: number; sales: number; units: number };
export type DayCount = { day: string; orders: number };

export type StoreDetail = {
  store: {
    account_id: string;
    account_name: string;
    platform: string;
    country: string;
    currency: string;
    timezone: string;
    store_id: string;
    name: string;
    /** Fecha local de hoy en la cuenta (YYYY-MM-DD). */
    today: string;
  };
  kpis: {
    today: number;
    d7: number;
    prev7: number;
    n30: number;
    sales30: number;
    vendor30: number;
    ticket: number | null;
    vendor_per_order: number | null;
    units_per_order: number | null;
    delivered30: number;
    failed30: number;
    active7: number;
    active_prev7: number;
    last_at: string | null;
    days_since: number | null;
    first_at: string | null;
  };
  /** Últimos 90 días locales, con los días sin pedidos en cero. */
  daily: StoreDay[];
  products: { product_key: string; name: string; orders: number; units: number; sales: number | null; share: number | null }[];
  activity: { best30: DayCount | null; record: DayCount | null };
  benchmark: { stores: number; orders_per_day: number | null; ticket: number | null; units_per_order: number | null; rank_d7: number } | null;
};

// ─── Fechas "YYYY-MM-DD" (sin zona: ya vienen en la fecha local de la cuenta) ───

const DAY_MS = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

export const addDays = (iso: string, n: number) => new Date(ms(iso) + n * DAY_MS).toISOString().slice(0, 10);
/** Días de `a` a `b` (b − a). */
export const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY_MS);
export const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(ms(s)) && addDays(s, 0) === s;

/** "8 sep" (o "8 sep 2025" si no es del año de referencia). */
export function fmtDay(iso: string, refYear?: string) {
  const withYear = refYear !== undefined && iso.slice(0, 4) !== refYear.slice(0, 4);
  return new Intl.DateTimeFormat("es-HN", { timeZone: "UTC", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) })
    .format(new Date(ms(iso)))
    .replace(/\./g, "");
}

// ─── Ventanas e impacto del seguimiento ───

export type Window = { days: number; orders: number; sales: number; perDay: number; ticket: number | null };

/** Suma de pedidos y ventas entre dos fechas (inclusive); `perDay` divide entre los días del rango. */
export function windowStats(daily: StoreDay[], from: string, to: string): Window {
  const days = daysBetween(from, to) + 1;
  let orders = 0;
  let sales = 0;
  for (const d of daily) if (d.day >= from && d.day <= to) {
    orders += d.orders;
    sales += d.sales;
  }
  return { days, orders, sales, perDay: orders / days, ticket: orders ? sales / orders : null };
}

export const IMPACT_DAYS = 7;

export type Impact =
  | { state: "measuring"; daysLeft: number }
  | { state: "no_data" }
  | { state: "ready"; before: Window; after: Window; ordersChange: number | null; ticketChange: number | null };

/**
 * Efecto de un contacto: los 7 días anteriores a la fecha de contacto vs. los 7 días
 * desde el contacto (el mismo día incluido). Se mide cuando ya pasaron los 7 días completos.
 */
export function impact(daily: StoreDay[], contactedAt: string, today: string): Impact {
  const elapsed = daysBetween(contactedAt, today);
  if (elapsed < IMPACT_DAYS) return { state: "measuring", daysLeft: IMPACT_DAYS - Math.max(0, elapsed) };
  const first = daily[0]?.day;
  const beforeFrom = addDays(contactedAt, -IMPACT_DAYS);
  if (!first || beforeFrom < first) return { state: "no_data" };
  const before = windowStats(daily, beforeFrom, addDays(contactedAt, -1));
  const after = windowStats(daily, contactedAt, addDays(contactedAt, IMPACT_DAYS - 1));
  return {
    state: "ready",
    before,
    after,
    ordersChange: pctChange(after.perDay, before.perDay),
    ticketChange: before.ticket !== null && after.ticket !== null ? pctChange(after.ticket, before.ticket) : null,
  };
}

/** Variación relativa (0.25 = +25 %); null si no hay base. */
export const pctChange = (cur: number, prev: number) => (prev > 0 ? (cur - prev) / prev : null);

// ─── Comparación con el promedio de la cuenta ───

export type Tone = "up" | "down" | "flat";

/** "30% arriba", "43% abajo", "en el promedio" (±10 %), o "3.2× el promedio" si lo duplica. */
export function vsAverage(value: number | null | undefined, avg: number | null | undefined): { tone: Tone; text: string } | null {
  if (value === null || value === undefined || !avg) return null;
  const c = (value - avg) / avg;
  if (Math.abs(c) < 0.1) return { tone: "flat", text: "en el promedio" };
  if (value >= avg * 2) return { tone: "up", text: `${(value / avg).toFixed(1)}× el promedio` };
  return { tone: c > 0 ? "up" : "down", text: `${Math.round(Math.abs(c) * 100)}% ${c > 0 ? "arriba" : "abajo"}` };
}

// ─── Gráfica ───

export const CHART_METRICS = {
  orders: "Pedidos",
  sales: "Ventas",
  ticket: "Ticket promedio",
  units: "Unidades",
} as const;
export type ChartMetric = keyof typeof CHART_METRICS;
export const CHART_RANGES = [7, 30, 90] as const;

/** Valor del día para la métrica; el ticket de un día sin pedidos es 0 (se ve como hueco). */
export function metricOf(d: StoreDay, m: ChartMetric): number {
  if (m === "ticket") return d.orders ? d.sales / d.orders : 0;
  return d[m];
}

/** Resumen del rango: total (o ticket ponderado) y promedio diario. */
export function rangeSummary(days: StoreDay[], m: ChartMetric): { total: number; perDay: number } {
  const n = Math.max(1, days.length);
  const orders = days.reduce((t, d) => t + d.orders, 0);
  const sales = days.reduce((t, d) => t + d.sales, 0);
  if (m === "ticket") {
    const t = orders ? sales / orders : 0;
    return { total: t, perDay: t };
  }
  const total = m === "orders" ? orders : m === "sales" ? sales : days.reduce((t, d) => t + d.units, 0);
  return { total, perDay: total / n };
}

/** Tope "redondo" del eje Y (5, 10, 25, 50, 100, 250…). */
export function niceMax(n: number) {
  if (n <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(n));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * pow).find((s) => n / s <= 4) ?? pow * 10;
  return Math.ceil(n / step) * step;
}

// ─── Seguimiento ───

export const FOLLOWUP_STATUS = {
  pendiente: { label: "Pendiente", tone: "warning" },
  en_curso: { label: "En curso", tone: "info" },
  hecho: { label: "Hecho", tone: "success" },
  sin_respuesta: { label: "Sin respuesta", tone: "neutral" },
} as const;
export type FollowupStatus = keyof typeof FOLLOWUP_STATUS;
export const OPEN_STATUSES: FollowupStatus[] = ["pendiente", "en_curso"];
export const isFollowupStatus = (s: string): s is FollowupStatus => Object.hasOwn(FOLLOWUP_STATUS, s);
