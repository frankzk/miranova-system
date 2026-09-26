import { todayIn } from "./format";
import { zonedToIso } from "./normalize";

// Períodos del panel. Los días empiezan a medianoche en la zona horaria de la cuenta.

export const RANGES = [
  { id: "hoy", label: "Hoy", short: "hoy" },
  { id: "ayer", label: "Ayer", short: "ayer" },
  { id: "7", label: "7 días", short: "7 días" },
  { id: "30", label: "30 días", short: "30 días" },
  { id: "90", label: "90 días", short: "90 días" },
] as const;

export type RangeId = (typeof RANGES)[number]["id"];
export const DEFAULT_RANGE: RangeId = "30";

export type Range = { id: RangeId; label: string; short: string; from: Date; to: Date; bucket: "hour" | "day" };

/** Medianoche (en `tz`) del día que está `offsetDays` días antes de hoy. */
function startOfDay(tz: string, offsetDays = 0): Date {
  const [y, m, d] = todayIn(tz).split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d - offsetDays));
  return new Date(zonedToIso(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 0, 0, 0, tz));
}

export function resolveRange(id: string | undefined, tz: string): Range {
  const r = RANGES.find((x) => x.id === id) ?? RANGES.find((x) => x.id === DEFAULT_RANGE)!;
  const now = new Date();
  if (r.id === "hoy") return { ...r, from: startOfDay(tz), to: now, bucket: "hour" };
  if (r.id === "ayer") return { ...r, from: startOfDay(tz, 1), to: new Date(startOfDay(tz).getTime() - 1), bucket: "hour" };
  const n = Number(r.id);
  return { ...r, from: startOfDay(tz, n - 1), to: now, bucket: "day" };
}
