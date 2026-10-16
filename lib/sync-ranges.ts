// Drop entrega cada rango de fechas del pedido más viejo al más nuevo y la sincronización tiene un
// tope de páginas por rango: si un rango tiene más pedidos que el tope, los más nuevos quedan fuera
// (pasó en Honduras al superar 6,000 pedidos en 45 días). Por eso cada rango se baja por tramos de
// una semana, del más nuevo al más viejo: lo reciente entra siempre primero.

const DAY = 86_400_000;
export const CHUNK_DAYS = 7;
/** Un minuto de solape entre tramos: un pedido justo en el borde no se pierde (si se repite, la huella lo salta). */
const OVERLAP_MS = 60_000;

/** Tramos de `from` a `to`, del más nuevo al más viejo, de hasta `days` días cada uno. */
export function rangeChunks(from: Date, to: Date, days = CHUNK_DAYS): { from: Date; to: Date }[] {
  const out: { from: Date; to: Date }[] = [];
  const start = from.getTime();
  for (let end = to.getTime(); end > start; end -= days * DAY) {
    out.push({ from: new Date(Math.max(start, end - days * DAY - OVERLAP_MS)), to: new Date(end) });
  }
  return out;
}
