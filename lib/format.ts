const TZ = "America/Tegucigalpa";

export function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("es-HN", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function fmtMoney(n: number | null, currency = "HNL"): string {
  if (n === null || n === undefined) return "—";
  const prefix = currency === "HNL" ? "L " : `${currency} `;
  return prefix + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Fecha de hoy (YYYY-MM-DD) en Honduras. */
export function todayHN(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}
