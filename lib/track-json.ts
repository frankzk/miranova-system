// Ayudas para leer respuestas JSON de las paqueteras con cuidado: todo es opcional, porque las
// plataformas agregan o mueven campos sin avisar.

export type Obj = Record<string, unknown>;
export const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
export const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** "2026-10-15T23:59:00-05:00" → "2026-10-15" (la fecha tal como viene, sin moverla de zona). */
export function ymd(v: unknown): string | null {
  const s = str(v);
  const m = s ? /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Quita espacios y guiones de un número de guía. */
export const cleanNumber = (n: string) => n.replace(/[\s-]+/g, "").toUpperCase();
