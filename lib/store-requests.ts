// Solicitudes de tiendas: lo que las tiendas le van pidiendo a Miranova (producto, cantidad y en
// qué países), para saber qué traer. Sin base de datos ni Next: sirve en servidor, cliente y pruebas.

export const REQUEST_STATUSES = [
  { id: "pending", label: "Solicitado", tone: "warning" },
  { id: "in_progress", label: "En tránsito", tone: "info" },
  { id: "done", label: "Llegó a Drop", tone: "success" },
  { id: "dropped", label: "Descartada", tone: "neutral" },
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number]["id"];

/** Las que todavía esperan respuesta. */
export const OPEN_STATUSES: readonly RequestStatus[] = ["pending", "in_progress"];

export const isRequestStatus = (v: unknown): v is RequestStatus => REQUEST_STATUSES.some((s) => s.id === v);
export const requestStatus = (id: string) => REQUEST_STATUSES.find((s) => s.id === id) ?? REQUEST_STATUSES[0];

/** Una línea del pedido: producto y cantidad. */
export type RequestItem = { product: string; quantity: number; country_quantities?: Record<string, number> };

/** Single-country legacy requests have an unambiguous destination. Never duplicate a shared quantity. */
export function requestAllocation(item: RequestItem, countries: readonly string[]): Record<string, number> {
  const entries = Object.entries(item.country_quantities ?? {}).filter(([c, n]) => countries.includes(c) && Number.isSafeInteger(n) && n > 0);
  return entries.length ? Object.fromEntries(entries) : countries.length === 1 ? { [countries[0]]: item.quantity } : {};
}

export type StoreRequest = {
  id: string;
  store_name: string;
  owner_name: string | null;
  /** Códigos de país (HN, GT…): una tienda puede trabajar varios. */
  countries: string[];
  /** Resumen: el primer producto (las líneas están en `items`). */
  product: string;
  /** Resumen: el total de unidades de todas las líneas. */
  quantity: number;
  /** Productos del pedido, en su orden (al menos uno). */
  items: RequestItem[];
  notes: string | null;
  /** Día en que la tienda lo pidió (YYYY-MM-DD). */
  requested_at: string;
  /** Para cuándo debe llegar (YYYY-MM-DD), si se sabe. */
  arrival_at: string | null;
  /** De dónde se traería el producto (p. ej. "China"). */
  origin_country: string | null;
  status: RequestStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type RequestFields = Pick<
  StoreRequest,
  "store_name" | "owner_name" | "countries" | "product" | "quantity" | "items" | "notes" | "requested_at" | "arrival_at" | "origin_country"
>;

/** Máximo de productos en un mismo pedido. */
export const MAX_ITEMS = 30;

/** Orígenes frecuentes para sugerir en el formulario (se puede escribir cualquiera). */
export const ORIGIN_SUGGESTIONS = ["China", "Estados Unidos", "México", "Colombia", "Panamá", "Guatemala", "Honduras", "El Salvador", "Costa Rica"];

/** "YYYY-MM-DD" que existe en el calendario. */
export function isDay(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

/** Para comparar nombres sin importar mayúsculas, tildes ni espacios de más. */
export const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const MAX_QTY = 10_000_000;

/**
 * Valida lo escrito en el formulario. `items`: los productos del pedido con su cantidad (las filas
 * vacías se ignoran y el mismo producto escrito dos veces se suma). `countries` admitidos: los de
 * las cuentas, en su orden (así "Honduras, Guatemala…" sale siempre igual). La cantidad acepta
 * "1,500" o "1500". La fecha de solicitud, si viene vacía, es `today`; no puede ser futura, y la de
 * llegada no puede ser anterior.
 */
export function cleanRequest(
  input: {
    store_name?: string; owner_name?: string; countries?: string[]; items?: { product?: string; quantity?: string; country_quantities?: Record<string, string> }[]; notes?: string;
    requested_at?: string; arrival_at?: string; origin_country?: string;
  },
  allowed: readonly string[],
  today: string = new Date().toISOString().slice(0, 10),
): { ok: true; row: RequestFields } | { ok: false; msg: string } {
  const text = (v: string | undefined, max: number) => (v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  const store_name = text(input.store_name, 120);
  if (!store_name) return { ok: false, msg: "Escribe el nombre de la tienda." };
  const lines = (input.items ?? []).map((i) => ({ product: text(i.product, 160), raw: (i.quantity ?? "").trim().replace(/[,\s]/g, ""), allocation: i.country_quantities }));
  const filled = lines.filter((l) => l.product || l.raw || Object.values(l.allocation ?? {}).some((v) => String(v).trim()));
  if (!filled.length) return { ok: false, msg: "Escribe qué producto pide." };
  if (filled.length > MAX_ITEMS) return { ok: false, msg: `Son demasiados productos: máximo ${MAX_ITEMS} por solicitud.` };
  const many = filled.length > 1;
  const items: RequestItem[] = [];
  for (const [n, l] of filled.entries()) {
    if (!l.product) return { ok: false, msg: many ? `Escribe el producto de la fila ${n + 1}.` : "Escribe qué producto pide." };
    const of = many ? ` de “${l.product}”` : "";
    if (!/^\d+$/.test(l.raw) || Number(l.raw) < 1) return { ok: false, msg: `La cantidad${of} debe ser un número entero mayor que cero.` };
    const qty = Number(l.raw);
    const allocation: Record<string, number> = {};
    for (const [country, value] of Object.entries(l.allocation ?? {})) {
      if (!allowed.includes(country) || !(input.countries ?? []).includes(country)) return { ok: false, msg: `El reparto de ${l.product} incluye un país no seleccionado: ${country}.` };
      const raw = String(value).replace(/[,\s]/g, "");
      if (!raw) continue;
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > MAX_QTY) return { ok: false, msg: `El reparto de ${l.product} debe usar cantidades enteras entre 0 y ${MAX_QTY}.` };
      if (Number(raw) > 0) allocation[country] = Number(raw);
    }
    if (Object.values(allocation).reduce((a, b) => a + b, 0) > qty) return { ok: false, msg: `El total repartido de ${l.product} supera la cantidad solicitada.` };
    const same = items.find((i) => norm(i.product) === norm(l.product));
    if (same) {
      const hasAllocation = Object.keys(same.country_quantities ?? {}).length > 0 || Object.keys(allocation).length > 0;
      const previous = hasAllocation ? requestAllocation(same, input.countries ?? []) : {};
      same.quantity += qty;
      const next = hasAllocation ? requestAllocation({ product: l.product, quantity: qty, country_quantities: allocation }, input.countries ?? []) : {};
      for (const [c, q] of Object.entries(next)) previous[c] = (previous[c] ?? 0) + q;
      if (Object.keys(previous).length) same.country_quantities = previous;
    } else items.push({ product: l.product, quantity: qty, ...(Object.keys(allocation).length ? { country_quantities: allocation } : {}) });
    if ((same?.quantity ?? qty) > MAX_QTY) return { ok: false, msg: `La cantidad${of} es demasiado grande.` };
  }
  const product = items[0].product;
  const quantity = items.reduce((t, i) => t + i.quantity, 0);
  const picked = new Set((input.countries ?? []).map((c) => c.trim().toUpperCase()));
  const unknown = [...picked].filter((c) => !allowed.includes(c));
  if (unknown.length) return { ok: false, msg: `País no válido: ${unknown.join(", ")}.` };
  const countries = allowed.filter((c) => picked.has(c));
  if (!countries.length) return { ok: false, msg: "Marca al menos un país." };
  const requested_at = (input.requested_at ?? "").trim() || today;
  if (!isDay(requested_at)) return { ok: false, msg: "La fecha de solicitud no es válida." };
  if (requested_at > today) return { ok: false, msg: "La fecha de solicitud no puede ser futura." };
  const arrival_at = (input.arrival_at ?? "").trim() || null;
  if (arrival_at && !isDay(arrival_at)) return { ok: false, msg: "La fecha de llegada no es válida." };
  if (arrival_at && arrival_at < requested_at) return { ok: false, msg: "La fecha de llegada no puede ser anterior a la solicitud." };
  const origin_country = text(input.origin_country, 60) || null;
  const owner_name = text(input.owner_name, 120) || null;
  const notes = (input.notes ?? "").trim().slice(0, 2000) || null;
  return { ok: true, row: { store_name, owner_name, countries, product, quantity, items, notes, requested_at, arrival_at, origin_country } };
}

/** Búsqueda libre: tienda, dueño, cualquiera de sus productos, origen o notas. */
export function matchesRequest(
  r: Pick<StoreRequest, "store_name" | "owner_name" | "product" | "notes"> & { origin_country?: string | null; items?: RequestItem[] },
  q: string | undefined,
): boolean {
  const needle = norm(q ?? "");
  if (!needle) return true;
  const products = r.items?.length ? r.items.map((i) => i.product) : [r.product];
  return [r.store_name, r.owner_name, ...products, r.origin_country, r.notes].some((v) => v && norm(v).includes(needle));
}

/** Líneas del pedido; si no tiene (solicitudes de antes), el producto y la cantidad del resumen. */
export const requestItems = (r: Pick<StoreRequest, "product" | "quantity"> & { items?: RequestItem[] }): RequestItem[] =>
  r.items?.length ? r.items : [{ product: r.product, quantity: r.quantity }];

/** Abierta y con la fecha de llegada ya pasada. */
export const isOverdue = (r: Pick<StoreRequest, "status" | "arrival_at">, today: string) =>
  !!r.arrival_at && r.arrival_at < today && (OPEN_STATUSES as readonly string[]).includes(r.status);

export type ProductDemand = {
  /** El nombre tal como se escribió en la solicitud más reciente. */
  product: string;
  units: number;
  requests: number;
  stores: number;
  /** Países pedidos, en el orden de `order` (los de las cuentas). */
  countries: string[];
  last: string;
  country_quantities: Record<string, number>;
  allocated: number;
  unallocated: number;
  statuses: Partial<Record<RequestStatus, number>>;
};

/**
 * Lo más pedido: suma por producto (mismo nombre sin importar mayúsculas ni tildes), con cuántas
 * solicitudes, cuántas tiendas distintas y en qué países. De más a menos unidades.
 */
export function demandByProduct(rows: readonly StoreRequest[], order: readonly string[] = []): ProductDemand[] {
  const groups = new Map<string, { product: string; units: number; requests: number; stores: Set<string>; countries: Set<string>; last: string; country_quantities: Record<string, number>; statuses: Partial<Record<RequestStatus, number>> }>();
  for (const r of rows) {
    for (const it of requestItems(r)) {
      const key = norm(it.product);
      const g = groups.get(key) ?? { product: it.product, units: 0, requests: 0, stores: new Set<string>(), countries: new Set<string>(), last: "", country_quantities: {}, statuses: {} };
      g.units += it.quantity;
      g.requests += 1;
      g.stores.add(norm(r.store_name));
      for (const [c, n] of Object.entries(requestAllocation(it, r.countries))) g.country_quantities[c] = (g.country_quantities[c] ?? 0) + n;
      g.statuses[r.status] = (g.statuses[r.status] ?? 0) + it.quantity;
      for (const c of r.countries) g.countries.add(c);
      if (r.created_at > g.last) {
        g.last = r.created_at;
        g.product = it.product;
      }
      groups.set(key, g);
    }
  }
  const rank = (c: string) => (order.includes(c) ? order.indexOf(c) : order.length);
  return [...groups.values()]
    .map((g) => ({
      product: g.product,
      units: g.units,
      requests: g.requests,
      stores: g.stores.size,
      countries: [...g.countries].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)),
      last: g.last,
      country_quantities: g.country_quantities,
      allocated: Object.values(g.country_quantities).reduce((a, b) => a + b, 0),
      unallocated: g.units - Object.values(g.country_quantities).reduce((a, b) => a + b, 0),
      statuses: g.statuses,
    }))
    .sort((a, b) => b.units - a.units || b.requests - a.requests || a.product.localeCompare(b.product, "es"));
}

export type StoreSuggestion = { name: string; owner: string | null; countries: string[] };

/**
 * Tiendas conocidas (de las cuentas de Drop) para autocompletar: una por nombre, con su dueño más
 * reciente y los países donde vende. Las que más venden primero.
 */
export function storeSuggestions(
  directory: readonly { name: string; person: string | null; country: string; last_at: string | null; orders90: number }[],
): StoreSuggestion[] {
  const groups = new Map<string, { name: string; owner: string | null; ownerAt: string; countries: Set<string>; orders: number }>();
  for (const s of directory) {
    const name = s.name?.trim();
    if (!name) continue;
    const key = norm(name);
    const g = groups.get(key) ?? { name, owner: null, ownerAt: "", countries: new Set<string>(), orders: 0 };
    g.countries.add(s.country);
    g.orders += s.orders90 ?? 0;
    if (s.person?.trim() && (s.last_at ?? "") >= g.ownerAt) {
      g.owner = s.person.trim();
      g.ownerAt = s.last_at ?? "";
    }
    groups.set(key, g);
  }
  return [...groups.values()]
    .sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name, "es"))
    .map((g) => ({ name: g.name, owner: g.owner, countries: [...g.countries] }));
}

/** Pestañas de la lista. */
export const REQUEST_VIEWS = [
  { id: "abiertas", label: "Abiertas", statuses: OPEN_STATUSES },
  { id: "atendidas", label: "Llegó a Drop", statuses: ["done"] },
  { id: "descartadas", label: "Descartadas", statuses: ["dropped"] },
  { id: "todas", label: "Todas", statuses: null },
] as const satisfies readonly { id: string; label: string; statuses: readonly RequestStatus[] | null }[];

export type RequestView = (typeof REQUEST_VIEWS)[number];
export type RequestFilters = { view: RequestView; country?: string; q?: string };

/** Filtros desde la URL: `v` (pestaña, por defecto Abiertas), `c` (país) y `q` (búsqueda). */
export function parseRequestFilters(sp: Record<string, string | string[] | undefined>): RequestFilters {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const country = one("c")?.toUpperCase();
  return {
    view: REQUEST_VIEWS.find((v) => v.id === one("v")) ?? REQUEST_VIEWS[0],
    country: country && /^[A-Z]{2}$/.test(country) ? country : undefined,
    q: one("q")?.slice(0, 120),
  };
}

export const inView = (r: Pick<StoreRequest, "status">, view: RequestView) => view.statuses === null || (view.statuses as readonly string[]).includes(r.status);

/** País y búsqueda (sin la pestaña): para contar cuántas hay en cada una. */
export const inScope = (r: StoreRequest, f: Pick<RequestFilters, "country" | "q">) => (!f.country || r.countries.includes(f.country)) && matchesRequest(r, f.q);

export function filterRequests<T extends StoreRequest>(rows: readonly T[], f: RequestFilters): T[] {
  return rows.filter((r) => inView(r, f.view) && inScope(r, f));
}
