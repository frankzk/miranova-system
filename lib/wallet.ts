// Saldo de la billetera del proveedor (Dinero → Saldo en billeteras).
// La ruta de la billetera en la API de la plataforma no es pública: se descubre con la sesión
// iniciada (ver discoverWalletPath en los conectores) y de su respuesta se lee el saldo con
// estas reglas, sin depender de la forma exacta del JSON.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export type WalletReading = {
  balance: number;
  /** Dónde estaba el saldo en la respuesta (p. ej. "data.balance"), para el diagnóstico. */
  key: string;
  /** Fecha de actualización que informa la plataforma, si la trae. */
  platformAt: string | null;
};

/** Claves que nombran el saldo directamente. */
const BALANCE_KEY = /^((current|available|actual|total|wallet|account)_?balance|balance(_?(amount|available|current))?|saldo(_?(actual|disponible|total))?)$/i;
/** Objeto que representa la billetera o el saldo: su monto va en una clave genérica. */
const WALLET_KEY = /^(balance|wallet|saldo|billetera)$/i;
const AMOUNT_KEY = /^(amount|available|current|balance|value|total|saldo)$/i;
const UPDATED_KEY = /^(updated_?at|last_?updated(_?at)?|balance_?updated_?at)$/i;

/** Número o texto numérico ("7,424.94", "$ 120.50"); null si no es un monto. */
export function amountOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/[\s$]|[A-Z]{3}$/g, "");
  if (!/^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(s)) return null;
  return Number(s.replace(/,/g, ""));
}

const updatedOf = (o: Obj): string | null => {
  for (const [k, v] of Object.entries(o)) if (UPDATED_KEY.test(k) && typeof v === "string" && v) return v;
  return null;
};

/**
 * Lee el saldo de la respuesta de la billetera. No entra en listas de varios elementos
 * (son movimientos, cuyos montos no son el saldo); una lista de un solo elemento sí se
 * revisa (una billetera).
 */
export function walletBalance(json: unknown): WalletReading | null {
  return search(json, "", 0);
}

function search(node: unknown, path: string, depth: number): WalletReading | null {
  if (depth > 5) return null;
  if (Array.isArray(node)) return node.length === 1 ? search(node[0], `${path}[0]`, depth + 1) : null;
  if (!isObj(node)) return null;
  const at = (k: string) => (path ? `${path}.${k}` : k);

  // 1. una clave que es el saldo
  for (const [k, v] of Object.entries(node)) {
    if (!BALANCE_KEY.test(k)) continue;
    const n = amountOf(v);
    if (n !== null) return { balance: n, key: at(k), platformAt: updatedOf(node) };
  }
  // 2. un objeto "balance"/"wallet" con el monto adentro
  for (const [k, v] of Object.entries(node)) {
    if (!WALLET_KEY.test(k) || !isObj(v)) continue;
    for (const [k2, v2] of Object.entries(v)) {
      if (!AMOUNT_KEY.test(k2)) continue;
      const n = amountOf(v2);
      if (n !== null) return { balance: n, key: `${at(k)}.${k2}`, platformAt: updatedOf(v) ?? updatedOf(node) };
    }
  }
  // 3. más adentro
  for (const [k, v] of Object.entries(node)) {
    if (typeof v !== "object" || v === null) continue;
    const r = search(v, at(k), depth + 1);
    if (r) return r;
  }
  return null;
}

/** Monto en dólares con el tipo de cambio de la cuenta (account_fx.usd_rate: USD por unidad). */
export function toUsd(amount: number, currency: string, usdRate: number | null): number | null {
  if (currency === "USD") return amount;
  return usdRate && usdRate > 0 ? amount * usdRate : null;
}
