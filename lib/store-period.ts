// Período de Salud de tiendas según la URL (?r=hoy|ayer|30|90, o ?from=&to=), el mismo para la
// página y la exportación. Por defecto, 7 días contra los 7 anteriores (lo de store_health).

import { previousWindow, rangeDays, resolveRange, type Range } from "./ranges.ts";

export const STORES_RANGE = "7";

export type StorePeriodChoice = {
  range: Range;
  /** false = el de siempre (7 días; no hace falta consultar store_period) */
  custom: boolean;
  /** días de calendario del período (7 en el de siempre) */
  days: number;
  /** el período anterior del mismo largo, para la variación */
  prev: { from: Date; to: Date };
};

type Params = Record<string, string | string[] | undefined>;
const first = (p: Params, k: string) => {
  const v = p[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};

export function storePeriodChoice(p: Params, tz: string): StorePeriodChoice {
  const range = resolveRange(first(p, "r") ?? STORES_RANGE, tz, { from: first(p, "from"), to: first(p, "to") });
  const custom = range.id !== STORES_RANGE;
  return { range, custom, days: custom ? rangeDays(range) : 7, prev: previousWindow(range) };
}

/** Parámetros de la URL del período ("" con el de siempre). */
export function periodParams(c: Pick<StorePeriodChoice, "range" | "custom">): Record<string, string | undefined> {
  if (!c.custom) return { r: undefined, from: undefined, to: undefined };
  if (c.range.id === "custom" && c.range.days) return { r: undefined, from: c.range.days.from, to: c.range.days.to };
  return { r: c.range.id, from: undefined, to: undefined };
}

/** "30 d", "hoy", "en el rango": para textos cortos como las sugerencias del buscador. */
export function periodUnit(c: Pick<StorePeriodChoice, "range" | "custom">): string {
  if (!c.custom) return "7 d";
  if (c.range.id === "hoy" || c.range.id === "ayer") return c.range.id;
  if (c.range.id === "custom") return "en el rango";
  return `${c.range.id} d`;
}

/** "vs. los 30 días anteriores" / "vs. el día anterior". */
export const prevPhrase = (days: number) => (days === 1 ? "vs. el día anterior" : `vs. los ${days} días anteriores`);
