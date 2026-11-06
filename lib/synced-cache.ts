import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";

// Caché compartida (en Vercel, entre todas las instancias) para las consultas pesadas que solo
// dependen de lo que llega de Drop: pedidos, productos, movimientos de stock y catálogo. Esos datos
// cambian únicamente al sincronizar (cada 10 min), así que el resultado se guarda hasta la próxima
// sincronización, que lo descarta con `refreshSynced()`. Por las dudas también vence a los 10 min.
//
// No va aquí nada que mezcle datos que se editan en el panel (contactos, seguimiento, pedidos de
// reposición, importaciones): eso se lee siempre al momento.

export const SYNCED_TAG = "drop-synced";
const TTL_SECONDS = 600;

/** Versión con caché de una consulta que solo lee datos sincronizados (la clave incluye los argumentos). */
export function synced<A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return unstable_cache(fn, ["synced", name], { tags: [SYNCED_TAG], revalidate: TTL_SECONDS });
}

/**
 * Marca lo guardado como viejo. Se llama al terminar una sincronización o una ingesta de la
 * extensión: la siguiente visita recibe al instante lo de antes (como mucho de la sincronización
 * anterior) y la consulta se rehace por detrás, así nadie espera a que se recalcule todo cada 10 min.
 * `now`: descartarlo ya (la siguiente visita espera los datos nuevos), para cuando se cambia una
 * cuenta en Ajustes y se espera verlo enseguida. Fuera de una acción o ruta de Next no se puede (y no
 * pasa nada: igual vence a los 10 min).
 */
export function refreshSynced(now = false): void {
  try {
    revalidateTag(SYNCED_TAG, now ? { expire: 0 } : "max");
  } catch {
    /* fuera de una acción o ruta de Next */
  }
}
