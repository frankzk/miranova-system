// Salud de tiendas (dropshippers): semáforo por ritmo de ventas y alertas comerciales.
// Datos de la función SQL `store_health`; aquí solo se clasifica, para poder probarlo.

import { norm } from "./store-contacts.ts";

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
  sales30: number | null;
  /** productos distintos con pedidos en 30 días */
  skus30: number;
  /** el producto que más pedidos le trae (30 días) y qué fracción de sus pedidos lo incluye */
  top_product: string | null;
  top_share: number | null;
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
  /** crecimiento fuerte: ritmo +50% o más con volumen real */
  strongGrowth: 0.5,
  strongGrowthMin: 10,
  /** producto ganador: un producto trae 70%+ de sus pedidos (y vende más de uno) */
  winnerShare: 0.7,
  /** vende un solo producto y mueve al menos esto por día: candidata a un segundo producto */
  singlePerDay: 3,
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

export type OpportunityKind = "silent" | "volume" | "growth" | "single" | "winner" | "ticket" | "units" | "delivery";
/** priority: 1 = contactar hoy (se frenó o cae), 2 = actuar esta semana, 3 = oportunidad de ticket */
export type Opportunity = { kind: OpportunityKind; text: string; action: string; priority: 1 | 2 | 3 };

export function opportunities(s: StoreRow, typical: number | null | undefined, fmt: (n: number) => string): Opportunity[] {
  const out: Opportunity[] = [];
  const c = change(s);
  const regular = s.active_prev7 >= RULES.regularDays;
  if (regular && (s.days_since ?? 0) >= RULES.silentDays && s.d7 < s.prev7) {
    out.push({ kind: "silent", text: `Se frenó: lleva ${s.days_since} días sin pedidos`, action: "vendía casi a diario: contactar a la tienda", priority: 1 });
  } else if (c !== null && c <= -0.25 && s.d7 + s.prev7 >= RULES.minVolume) {
    out.push({ kind: "volume", text: `Pedidos ${Math.round(c * 100)}% vs. semana anterior`, action: "revisar pauta, producto o creativo", priority: 1 });
  } else if (c !== null && c >= RULES.strongGrowth && s.d7 >= RULES.strongGrowthMin) {
    out.push({ kind: "growth", text: `Crecimiento fuerte: pedidos +${Math.round(c * 100)}%`, action: "contactar para asegurar inventario y ayudar a escalar", priority: 2 });
  }
  if (s.skus30 === 1 && s.d7 / 7 >= RULES.singlePerDay) {
    out.push({
      kind: "single",
      text: `Solo vende ${s.top_product ?? "1 producto"} y mueve ${(s.d7 / 7).toFixed(1)} pedidos/día`,
      action: "ofrecerle un segundo producto",
      priority: 2,
    });
  } else if (s.skus30 > 1 && s.n30 >= RULES.minSample && s.top_share !== null && s.top_share >= RULES.winnerShare) {
    out.push({
      kind: "winner",
      text: `Producto ganador: ${Math.round(s.top_share * 100)}% de sus pedidos son ${s.top_product}`,
      action: "ofrecer productos complementarios",
      priority: 2,
    });
  }
  if (s.n30 >= RULES.minSample) {
    if (typical && s.ticket !== null && s.ticket < typical * RULES.lowTicket) {
      out.push({ kind: "ticket", text: `Ticket ${fmt(s.ticket)} vs. ${fmt(typical)} típico`, action: "oportunidad de bundle o upsell", priority: 3 });
    }
    if (s.units_per_order !== null && s.units_per_order < RULES.lowUnits) {
      out.push({ kind: "units", text: `${s.units_per_order.toFixed(2)} productos por orden`, action: "probar oferta 1, 2 y 3 unidades", priority: 3 });
    }
  }
  const dr = deliveryRate(s);
  if (dr !== null && dr < RULES.lowDelivery) {
    out.push({ kind: "delivery", text: `Entrega ${Math.round(dr * 100)}%`, action: "revisar confirmación de pedidos", priority: 2 });
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
  skus_desc: "Más productos",
  skus_asc: "Menos productos",
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
    skus_desc: (s) => -s.skus30,
    skus_asc: (s) => s.skus30,
    silent: (s) => -nz(s.days_since, -Infinity),
  };
  const k = key[sort];
  return [...rows].sort((a, b) => k(a) - k(b) || b.d7 - a.d7 || a.name.localeCompare(b.name, "es"));
}

/**
 * Búsqueda por nombre de tienda: sin distinguir mayúsculas ni tildes, y cada palabra buscada
 * tiene que aparecer ("hond velora" encuentra "Velora Honduras"). Vacío = todas.
 */
export function matchesStore(name: string, q: string | undefined | null): boolean {
  const words = norm(q ?? "").split(" ").filter(Boolean);
  if (!words.length) return true;
  const n = norm(name);
  return words.every((w) => n.includes(w));
}

/** Identidad de una tienda en la URL (`?t=`): la misma tienda puede estar en varias cuentas. */
export const storeKey = (s: Pick<StoreRow, "account_id" | "store_id">) => `${s.account_id}:${s.store_id}`;

/**
 * Filtro del buscador de Salud de tiendas: las tiendas elegidas de la lista (`keys`) más las que
 * coinciden con el texto (`q`). Sin ninguno de los dos, todas.
 */
export function filterStores<T extends Pick<StoreRow, "account_id" | "store_id" | "name">>(
  rows: T[],
  { keys, q }: { keys?: readonly string[]; q?: string | null },
): T[] {
  const picked = new Set(keys ?? []);
  const text = norm(q ?? "");
  if (!picked.size && !text) return rows;
  return rows.filter((s) => picked.has(storeKey(s)) || (!!text && matchesStore(s.name, text)));
}

/** Tiendas a contactar hoy: en alerta o descenso, las que más pedidos dejaron de hacer. */
export function toContact(rows: StoreRow[], limit = 5): StoreRow[] {
  return rows
    .filter((s) => ["alert", "declining"].includes(classify(s)))
    .sort((a, b) => (b.prev7 - b.d7) - (a.prev7 - a.d7))
    .slice(0, limit);
}
