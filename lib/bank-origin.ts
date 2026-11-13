// De qué operación viene cada transferencia de Boxful: Miranova o Mireva, y de qué país (la liquidación de
// "Mireva Costa Rica", "Miranova Honduras"…). Se guarda aparte del movimiento (origin_operation y
// origin_country en bank_entries) y se puede indicar aunque ya esté conciliado. Sin base de datos, para probarlo.

export const ORIGIN_OPERATIONS = [
  { id: "miranova", label: "Miranova" },
  { id: "mireva", label: "Mireva" },
] as const;
export type OriginOperation = (typeof ORIGIN_OPERATIONS)[number]["id"];

export const ORIGIN_COUNTRIES = [
  { id: "HN", label: "Honduras" },
  { id: "GT", label: "Guatemala" },
  { id: "SV", label: "El Salvador" },
  { id: "CR", label: "Costa Rica" },
] as const;
export type OriginCountry = (typeof ORIGIN_COUNTRIES)[number]["id"];

export const isOriginOperation = (v: unknown): v is OriginOperation => ORIGIN_OPERATIONS.some((o) => o.id === v);
export const isOriginCountry = (v: unknown): v is OriginCountry => ORIGIN_COUNTRIES.some((c) => c.id === v);

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();

const COUNTRY_RE: Record<OriginCountry, RegExp> = {
  HN: /(^|[^A-Z0-9])(HN|HONDURAS)(?![A-Z0-9])/,
  GT: /(^|[^A-Z0-9])(GT|GUATEMALA)(?![A-Z0-9])/,
  SV: /(^|[^A-Z0-9])(SV|SALVADOR)(?![A-Z0-9])/,
  CR: /(^|[^A-Z0-9])(CR|COSTA RICA)(?![A-Z0-9])/,
};

/**
 * Lo que se puede deducir del texto (referencia, notas, nombre del PDF): "LIQUIDACION MIREVA CR",
 * "Miranova SV - Pago Bodega", "MIREVA LIQ FULFILLMENT HN". Si menciona las dos operaciones o varios
 * países, no adivina (queda null).
 */
export function guessOrigin(...texts: (string | null | undefined)[]): { operation: OriginOperation | null; country: OriginCountry | null } {
  const t = fold(texts.filter(Boolean).join(" "));
  const mireva = /(^|[^A-Z])MIREVA(?![A-Z])/.test(t);
  const miranova = /(^|[^A-Z])MIRANOVA(?![A-Z])/.test(t);
  const countries = ORIGIN_COUNTRIES.map((c) => c.id).filter((c) => COUNTRY_RE[c].test(t));
  return {
    operation: mireva === miranova ? null : mireva ? "mireva" : "miranova",
    country: countries.length === 1 ? countries[0] : null,
  };
}

/** "Mireva · Honduras", "Miranova", "Costa Rica" o null si no se indicó nada. */
export function originLabel(operation: string | null | undefined, country: string | null | undefined): string | null {
  const op = ORIGIN_OPERATIONS.find((o) => o.id === operation)?.label;
  const ct = ORIGIN_COUNTRIES.find((c) => c.id === country)?.label;
  return [op, ct].filter(Boolean).join(" · ") || null;
}

/** Valores del formulario: vacío es "sin indicar"; cualquier otra cosa debe ser válida. */
export function cleanOrigin(operation: string, country: string):
  | { ok: true; row: { origin_operation: OriginOperation | null; origin_country: OriginCountry | null } }
  | { ok: false; msg: string } {
  const op = operation.trim(), ct = country.trim().toUpperCase();
  if (op && !isOriginOperation(op)) return { ok: false, msg: "Elige si viene de Miranova o de Mireva." };
  if (ct && !isOriginCountry(ct)) return { ok: false, msg: "Elige el país de la operación." };
  return { ok: true, row: { origin_operation: (op || null) as OriginOperation | null, origin_country: (ct || null) as OriginCountry | null } };
}
