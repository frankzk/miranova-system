// Memoria corta en el servidor para consultas pesadas que no cambian a cada rato (se sincroniza
// cada 10 minutos): abrir el panel de varias tiendas seguidas no recalcula todo cada vez. Vive
// en la instancia del servidor; un error no se guarda.

const store = new Map<string, { at: number; value: Promise<unknown> }>();
const MAX_KEYS = 200;

/** Devuelve el resultado guardado de `key` si tiene menos de `ttlMs`; si no, llama a `fn`. */
export function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>, now = Date.now()): Promise<T> {
  const hit = store.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = fn();
  store.set(key, { at: now, value });
  value.catch(() => {
    if (store.get(key)?.value === value) store.delete(key);
  });
  if (store.size > MAX_KEYS) store.delete(store.keys().next().value!);
  return value;
}

export const clearMemo = () => store.clear();
