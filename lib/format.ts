export const DEFAULT_TZ = "America/Tegucigalpa";

const CURRENCY_SYMBOL: Record<string, string> = {
  HNL: "L",
  GTQ: "Q",
  USD: "$",
  NIO: "C$",
  CRC: "₡",
  DOP: "RD$",
  MXN: "MX$",
  COP: "COL$",
  PEN: "S/",
  CLP: "CLP$",
  PYG: "₲",
  ARS: "AR$",
  EUR: "€",
};

export function fmtDate(iso: string | null, tz = DEFAULT_TZ): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("es-HN", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** "25 sep, 16:52" */
export function fmtShort(iso: string | null, tz = DEFAULT_TZ): string {
  if (!iso) return "";
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("es-HN", { timeZone: tz, day: "numeric", month: "short" }).format(d).replace(".", "");
  const time = new Intl.DateTimeFormat("es-HN", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${date}, ${time}`;
}

/** "jueves, 25 de septiembre" */
export function fmtLongDay(date: Date, tz = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("es-HN", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(date);
}

export function currencySymbol(currency = "HNL"): string {
  return CURRENCY_SYMBOL[currency] ?? `${currency} `;
}

/** `compact`: 12.5K a partir de 10 000; con `always`, desde 1 000 (para que cifras vecinas usen el mismo formato). */
export function fmtMoney(n: number | null | undefined, currency = "HNL", opts: { compact?: boolean; always?: boolean } = {}): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  const body = opts.compact && Math.abs(v) >= (opts.always ? 1000 : 10000)
    ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v)
    : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sym = currencySymbol(currency);
  return `${sym}${/[A-Z]$/.test(sym) ? " " : ""}${body}`;
}

export function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

/** "hace 3 min", "hace 2 h", "hace 4 días" */
export function fmtAgo(iso: string | null): string {
  if (!iso) return "nunca";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}

/** Fecha de hoy (YYYY-MM-DD) en la zona indicada. */
export function todayIn(tz = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

/** Compatibilidad con código anterior. */
export const todayHN = () => todayIn(DEFAULT_TZ);
