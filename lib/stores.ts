// Salud de tiendas (dropshippers): semáforo por ritmo de ventas y alertas comerciales.
// Datos de la función SQL `store_health`; aquí solo se clasifica, para poder probarlo.

export type StoreRow = {
  account_id: string;
  /** ID del vendedor en la plataforma (o "name:<nombre>" si no viene). */
  store_id: string;
  account_name: string;
  currency: string;
  name: string;
  today: number;
  d7: number;
  prev7: number;
  active7: number;
  active_prev7: number;
  last_at: string | null;
  days_since: number | null;
  n30: number;
  ticket: number | null;
  vendor_per_order: number | null;
  units_per_order: number | null;
  delivered30: number;
  failed30: number;
  daily: number[];
};

export type Health = "growing" | "new" | "stable" | "declining" | "alert" | "inactive";

export const HEALTH: Record<Health, { label: string; tone: string; hint: string }> = {
  growing: { label: "Creciendo", tone: "success", hint: "Ritmo de 7 días más de 15% arriba de los 7 anteriores" },
  new: { label: "Nueva", tone: "accent", hint: "Vende esta semana y no vendía la anterior" },
  stable: { label: "Estable", tone: "info", hint: "Variación entre −15% y +15%" },
  declining: { label: "En descenso", tone: "warning", hint: "Ritmo de 7 días más de 15% abajo" },
  alert: { label: "Alerta", tone: "danger", hint: "Caída mayor a 35%, o vendía seguido y lleva 2+ días sin pedidos" },
  inactive: { label: "Inactiva", tone: "neutral", hint: "Sin pedidos en los últimos 7 días" },
};
export const HEALTH_ORDER: Health[] = ["alert", "declining", "inactive", "stable", "growing", "new"];

/** Umbrales del semáforo (en un solo lugar para ajustarlos). */
export const RULES = {
  up: 0.15,
  down: -0.15,
  alert: -0.35,
  inactiveDays: 7,
  /** "Venía vendiendo seguido": días con ventas en la semana anterior. */
  regularDays: 5,
  silentDays: 2,
  /** Por debajo de estos pedidos (dos semanas) el % es ruido y no se usa para clasificar. */
  minVolume: 6,
  lowTicket: 0.85,
  lowUnits: 1.15,
  lowDelivery: 0.6,
  minSample: 10,
};

/** Variación del ritmo vs. los 7 días anteriores (null si no hay base para comparar). */
export const change = (s: StoreRow) => (s.prev7 > 0 ? (s.d7 - s.prev7) / s.prev7 : null);

export function classify(s: StoreRow): Health {
  const days = s.days_since ?? Infinity;
  if (s.d7 === 0 && days >= RULES.inactiveDays) return "inactive";
  if (s.active_prev7 >= RULES.regularDays && days >= RULES.silentDays) return "alert";
  if (s.prev7 === 0) return s.d7 > 0 ? "new" : "inactive";
  const c = change(s)!;
  if (s.d7 + s.prev7 < RULES.minVolume) return "stable";
  if (c <= RULES.alert) return "alert";
  if (c < RULES.down) return "declining";
  if (c > RULES.up) return "growing";
  return "stable";
}

export const deliveryRate = (s: StoreRow) => {
  const closed = s.delivered30 + s.failed30;
  return closed >= RULES.minSample ? s.delivered30 / closed : null;
};

function median(xs: number[]) {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Ticket típico por cuenta (mediana de tiendas con muestra suficiente): referencia para "ticket bajo". */
export function typicalTickets(rows: StoreRow[]): Record<string, number | null> {
  const by: Record<string, number[]> = {};
  for (const s of rows) if (s.ticket !== null && s.n30 >= RULES.minSample) (by[s.account_id] ??= []).push(s.ticket);
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, median(v)]));
}

export type Opportunity = { kind: "volume" | "ticket" | "units" | "delivery" | "silent"; text: string; action: string };

export function opportunities(s: StoreRow, typical: number | null | undefined, fmt: (n: number) => string): Opportunity[] {
  const out: Opportunity[] = [];
  const c = change(s);
  const regular = s.active_prev7 >= RULES.regularDays;
  if (regular && (s.days_since ?? 0) >= RULES.silentDays && s.d7 < s.prev7) {
    out.push({ kind: "silent", text: `Lleva ${s.days_since} días sin pedidos`, action: "vendía casi a diario: contactar hoy" });
  } else if (c !== null && c <= -0.25 && s.d7 + s.prev7 >= RULES.minVolume) {
    out.push({ kind: "volume", text: `Pedidos ${Math.round(c * 100)}% vs. semana anterior`, action: "revisar pauta, producto o creativo" });
  }
  if (s.n30 >= RULES.minSample) {
    if (typical && s.ticket !== null && s.ticket < typical * RULES.lowTicket) {
      out.push({ kind: "ticket", text: `Ticket ${fmt(s.ticket)} vs. ${fmt(typical)} típico`, action: "oportunidad de bundle o upsell" });
    }
    if (s.units_per_order !== null && s.units_per_order < RULES.lowUnits) {
      out.push({ kind: "units", text: `${s.units_per_order.toFixed(2)} productos por orden`, action: "probar oferta 2x o 3x" });
    }
  }
  const dr = deliveryRate(s);
  if (dr !== null && dr < RULES.lowDelivery) {
    out.push({ kind: "delivery", text: `Entrega ${Math.round(dr * 100)}%`, action: "revisar confirmación de pedidos" });
  }
  return out;
}

export const STORE_SORTS = {
  d7_desc: "Más pedidos (7 días)",
  d7_asc: "Menos pedidos (7 días)",
  today_desc: "Más pedidos hoy",
  drop: "Mayor caída",
  rise: "Mayor crecimiento",
  active_desc: "Más constantes",
  active_asc: "Menos constantes",
  ticket_desc: "Ticket más alto",
  ticket_asc: "Ticket más bajo",
  units_asc: "Menos unidades por pedido",
  units_desc: "Más unidades por pedido",
  vendor_desc: "Más te toca por pedido",
  silent: "Más días sin vender",
} as const;
export type StoreSort = keyof typeof STORE_SORTS;

export function sortStores(rows: StoreRow[], sort: StoreSort): StoreRow[] {
  const nz = (v: number | null | undefined, empty: number) => (v === null || v === undefined ? empty : v);
  const key: Record<StoreSort, (s: StoreRow) => number> = {
    d7_desc: (s) => -s.d7,
    d7_asc: (s) => s.d7,
    today_desc: (s) => -s.today,
    // caída: en pedidos perdidos por semana, para que pese el volumen y no solo el %
    drop: (s) => s.d7 - s.prev7,
    rise: (s) => s.prev7 - s.d7,
    active_desc: (s) => -s.active7,
    active_asc: (s) => s.active7,
    ticket_desc: (s) => -nz(s.ticket, -Infinity),
    ticket_asc: (s) => nz(s.ticket, Infinity),
    units_asc: (s) => nz(s.units_per_order, Infinity),
    units_desc: (s) => -nz(s.units_per_order, -Infinity),
    vendor_desc: (s) => -nz(s.vendor_per_order, -Infinity),
    silent: (s) => -nz(s.days_since, -Infinity),
  };
  const k = key[sort];
  return [...rows].sort((a, b) => k(a) - k(b) || b.d7 - a.d7 || a.name.localeCompare(b.name, "es"));
}

/** Tiendas a contactar hoy: en alerta o descenso, las que más pedidos dejaron de hacer. */
export function toContact(rows: StoreRow[], limit = 5): StoreRow[] {
  return rows
    .filter((s) => ["alert", "declining"].includes(classify(s)))
    .sort((a, b) => (b.prev7 - b.d7) - (a.prev7 - a.d7))
    .slice(0, limit);
}
