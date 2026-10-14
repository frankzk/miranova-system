import { createHash } from "node:crypto";

// Huella de lo que llegó de Drop para una orden o un producto: si la siguiente sincronización
// trae exactamente lo mismo, no hace falta volver a escribirlo. Subir la versión obliga a
// reescribir todo una vez (p. ej. si cambia cómo se guarda algo que no sale de la respuesta).
const VERSION = 1;

/** JSON con las claves ordenadas: el mismo contenido da siempre el mismo texto. */
function stable(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export function syncHash(value: unknown): string {
  return createHash("sha1").update(`${VERSION}:${stable(value)}`).digest("base64url");
}

/**
 * Lo que llegó distinto a lo guardado (o es nuevo): compara la huella de cada elemento con la
 * guardada para su clave. Devuelve también todas las huellas, para guardarlas con lo escrito.
 */
export function changedSince<T>(items: T[], key: (item: T) => string, stored: Map<string, string | null>): { changed: T[]; hashes: Map<string, string> } {
  const hashes = new Map(items.map((i) => [key(i), syncHash(i)]));
  return { changed: items.filter((i) => stored.get(key(i)) !== hashes.get(key(i))), hashes };
}
