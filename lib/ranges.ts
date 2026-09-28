import { todayIn } from "./format.ts";
import { zonedToIso } from "./normalize.ts";

// Períodos del panel. Los días empiezan a medianoche en la zona horaria de la cuenta.

export const RANGES = [
  { id: "hoy", label: "Hoy", short: "hoy" },
  { id: "ayer", label: "Ayer", short: "ayer" },
  { id: "7", label: "7 días", short: "7 días" },
  { id: "30", label: "30 días", short: "30 días" },
  { id: "90", label: "90 días", short: "90 días" },
] as const;

export type PresetId = (typeof RANGES)[number]["id"];
export type RangeId = PresetId | "custom";
export const DEFAULT_RANGE: PresetId = "30";

/** Un rango propio no puede pasar de este largo (días). */
export const MAX_CUSTOM_DAYS = 366;

export type Range = {
  id: RangeId;
  label: string;
  short: string;
  /** Para frases: "hoy", "en 30 días", "del 15 al 28 sep". */
  during: string;
  from: Date;
  to: Date;
  bucket: "hour" | "day";
  /** Solo en un rango propio: las fechas (YYYY-MM-DD) ya validadas, para volver a armar la URL. */
  days?: { from: string; to: string };
};

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" válido del calendario, o null. */
export function parseYmd(s: string | undefined | null): string | null {
  const m = s ? YMD.exec(s.trim()) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return m[0];
}

/** Suma días a una fecha "YYYY-MM-DD". */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Medianoche (en `tz`) del día `ymd`. */
function dayStart(ymd: string, tz: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(zonedToIso(y, m, d, 0, 0, 0, tz));
}

/** Medianoche (en `tz`) del día que está `offsetDays` días antes de hoy. */
const startOfDay = (tz: string, offsetDays = 0) => dayStart(addDays(todayIn(tz), -offsetDays), tz);

/**
 * Normaliza un rango propio: acepta solo "desde", solo "hasta" o ambos; los ordena si vienen al
 * revés, no pasa de hoy y no pasa de MAX_CUSTOM_DAYS. Null si no hay ninguna fecha válida.
 */
export function customDays(from: string | undefined, to: string | undefined, today: string): { from: string; to: string } | null {
  let f = parseYmd(from);
  let t = parseYmd(to);
  if (!f && !t) return null;
  // solo "desde": hasta hoy; solo "hasta": ese día
  if (!t) t = today;
  if (!f) f = t;
  if (f > t) [f, t] = [t, f];
  if (t > today) t = today;
  if (f > t) f = t;
  if (daysBetween(f, t) + 1 > MAX_CUSTOM_DAYS) f = addDays(t, -(MAX_CUSTOM_DAYS - 1));
  return { from: f, to: t };
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "15 sep", o "15 sep 2025" si no es del año de `today`. */
function dayLabel(ymd: string, today: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${String(y) === today.slice(0, 4) ? "" : ` ${y}`}`;
}

/** Textos de un rango propio: corto ("15 – 28 sep") y para frases ("del 15 al 28 sep"). */
export function customLabels(from: string, to: string, today: string): { short: string; during: string } {
  if (from === to) {
    const one = dayLabel(from, today);
    return { short: one, during: `el ${one}` };
  }
  const a = dayLabel(from, today);
  const b = dayLabel(to, today);
  // mismo mes y año: "15 – 28 sep"
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const aShort = sameMonth ? String(Number(from.slice(8))) : a;
  return { short: `${aShort} – ${b}`, during: `del ${aShort} al ${b}` };
}

export function resolveRange(id: string | undefined, tz: string, custom?: { from?: string; to?: string }): Range {
  const now = new Date();
  const today = todayIn(tz);
  const days = custom ? customDays(custom.from, custom.to, today) : null;
  if (days) {
    const { short, during } = customLabels(days.from, days.to, today);
    // el último día termina a medianoche del siguiente (o ahora, si es hoy)
    const to = days.to === today ? now : new Date(dayStart(addDays(days.to, 1), tz).getTime() - 1);
    return {
      id: "custom",
      label: short,
      short,
      during,
      from: dayStart(days.from, tz),
      to,
      bucket: days.from === days.to ? "hour" : "day",
      days,
    };
  }

  const r = RANGES.find((x) => x.id === id) ?? RANGES.find((x) => x.id === DEFAULT_RANGE)!;
  if (r.id === "hoy") return { ...r, during: "hoy", from: startOfDay(tz), to: now, bucket: "hour" };
  if (r.id === "ayer") return { ...r, during: "ayer", from: startOfDay(tz, 1), to: new Date(startOfDay(tz).getTime() - 1), bucket: "hour" };
  const n = Number(r.id);
  return { ...r, during: `en ${r.short}`, from: startOfDay(tz, n - 1), to: now, bucket: "day" };
}

/** Parámetros de la URL de Inicio para un rango ("" = el de siempre, 30 días). */
export function rangeQuery(r: Pick<Range, "id" | "days">): string {
  if (r.id === "custom" && r.days) return new URLSearchParams({ from: r.days.from, to: r.days.to }).toString();
  return r.id === DEFAULT_RANGE ? "" : new URLSearchParams({ r: r.id }).toString();
}
