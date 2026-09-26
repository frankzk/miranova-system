// Movimientos de inventario (Drop: GET /products/{id}/stock-movements?page&limit).
// La forma exacta de la respuesta no está documentada: se busca la lista en las llaves usuales y
// cada campo en varios nombres posibles. El movimiento original se guarda completo en `raw`.

type Obj = Record<string, unknown>;

export type NormalizedMovement = {
  external_id: string;
  number: number | null;
  units: number | null;
  balance: number | null;
  kind: string | null;
  /** motivo: ORDER_DISPATCH, ORDER_RETURN, STOCK_REQUEST, RESERVE, RELEASE, MANUAL, INITIAL_STOCK… */
  reason: string | null;
  /** variante (talla, color), si el movimiento es de una variante */
  variant: string | null;
  description: string | null;
  order_number: string | null;
  occurred_at: string | null;
  raw: Obj;
};

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function pick(o: Obj, keys: string[]): unknown {
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  }
  return undefined;
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

const F = {
  id: ["_id", "id", "movementId", "uuid"],
  number: ["movementNumber", "number", "consecutive", "sequence", "seq", "folio", "index"],
  units: ["quantity", "units", "qty", "amount", "delta", "change", "stockChange", "quantityChange"],
  balance: ["newQty", "balance", "stockAfter", "newStock", "resultingStock", "currentStock", "stock", "totalAfter"],
  kind: ["type", "movementType", "kind", "operation", "direction"],
  reason: ["reason", "motive", "cause"],
  description: ["description", "detail", "details", "note", "notes", "comment", "concept", "reasonDescription"],
  date: ["createdAt", "created_at", "date", "occurredAt", "timestamp", "updatedAt"],
  order: ["orderNumber", "orderId", "order", "reference", "referenceId"],
};

const LIST_KEYS = ["movements", "stockMovements", "stock_movements", "items", "data", "docs", "results", "records", "rows", "list"];

/** Encuentra la lista de movimientos en la respuesta (puede venir anidada: {data: {movements: [...]}}). */
export function extractMovementList(payload: unknown, depth = 0): Obj[] {
  if (Array.isArray(payload)) return payload.filter(isObj);
  if (!isObj(payload) || depth > 3) return [];
  for (const k of LIST_KEYS) {
    const v = payload[k];
    if (Array.isArray(v)) return v.filter(isObj);
  }
  for (const k of LIST_KEYS) {
    const found = extractMovementList(payload[k], depth + 1);
    if (found.length) return found;
  }
  return [];
}

/** Total de movimientos que informa la respuesta ("Mostrando 10 de 45"), si viene. */
export function movementTotal(payload: unknown, depth = 0): number | null {
  if (!isObj(payload) || depth > 3) return null;
  const t = num(pick(payload, ["total", "totalItems", "totalDocs", "count", "totalCount", "totalRecords"]));
  if (t !== null) return t;
  for (const k of [...LIST_KEYS, "pagination", "meta", "paging"]) {
    const found = movementTotal(payload[k], depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/** "Salida por orden #1789240822725" → "1789240822725". */
export function orderNumberFrom(text: string | null): string | null {
  if (!text) return null;
  const m = text.match(/#\s*([A-Za-z0-9-]{4,})/) ?? text.match(/orden\s+([0-9]{6,})/i);
  return m ? m[1] : null;
}

export function normalizeMovement(raw: Obj): NormalizedMovement | null {
  const number = num(pick(raw, F.number));
  const id = str(pick(raw, F.id)) ?? (number !== null ? `n:${number}` : null);
  if (!id) return null;

  let units = num(pick(raw, F.units));
  const kind = str(pick(raw, F.kind));
  const description = str(pick(raw, F.description));
  // si la cantidad viene sin signo, el tipo o la descripción dicen si es salida
  if (units !== null && units > 0 && /salida|out|egreso|decrease|remove|sale|venta|orden/i.test(`${kind ?? ""} ${description ?? ""}`)
      && !/entrada|ingreso|in\b|increase|add|devoluci|return/i.test(kind ?? "")) {
    units = -units;
  }

  const order = pick(raw, F.order);
  const orderStr = isObj(order) ? str(pick(order, ["orderNumber", "number", "_id", "id"])) : str(order);
  const dateRaw = str(pick(raw, F.date));
  const date = dateRaw && !Number.isNaN(Date.parse(dateRaw)) ? new Date(dateRaw).toISOString() : null;

  return {
    external_id: id,
    number,
    units,
    balance: num(pick(raw, F.balance)),
    kind,
    reason: str(pick(raw, F.reason)),
    variant: isObj(raw.variant) ? str(pick(raw.variant, ["name", "sku"])) : str(raw.variant),
    description,
    order_number: orderNumberFrom(description) ?? orderStr,
    occurred_at: date,
    raw,
  };
}

export function extractMovements(payload: unknown): NormalizedMovement[] {
  return extractMovementList(payload).map(normalizeMovement).filter((m): m is NormalizedMovement => m !== null);
}
