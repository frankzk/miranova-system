// Rendimiento de productos: tendencia (semáforo como el de tiendas) y oportunidades por producto.
// Datos de la función SQL `product_performance`; aquí solo se clasifica, para poder probarlo.
// También lo usa la pantalla de Oportunidades (productInsights).

export type ProductPerf = {
  account_id: string;
  account_name: string;
  currency: string;
  /** Identidad estable del producto (ID en la plataforma, o "sku:<sku>"), como line_facts. */
  product_key: string;
  /** UUID del catálogo (null si el producto ya no está en el catálogo). */
  product_id: string | null;
  name: string;
  image_url: string | null;
  /** Estado en el catálogo ("Activo" / "Inactivo"); null si no está en el catálogo. */
  status: string | null;
  stock: number | null;
  /** Alta del producto en la plataforma. */
  created_at: string | null;
  first_order_at: string | null;
  orders7: number;
  prev7: number;
  orders30: number;
  units30: number;
  stores30: number;
  stores7: number;
  /** Total promedio de los pedidos que lo incluyen (30 días). */
  ticket: number | null;
  /** Tiendas de la cuenta con pedidos en 30 / 7 días. */
  active_stores30: number;
  active_stores7: number;
  /** Pedidos por día, últimos 14 días (el último es hoy). */
  daily: number[];
};

/** Umbrales (en un solo lugar para ajustarlos). */
export const PRODUCT_RULES = {
  up: 0.15,
  down: -0.15,
  strong: 0.35,
  /** Por debajo de estos pedidos (dos semanas) el % es ruido y no se usa. */
  minVolume: 6,
  /** Días disponible antes de juzgar si un producto se mueve poco. */
  minAgeDays: 14,
  /** Bajo movimiento: pedidos por tienda que lo vende, por semana. */
  lowPerStoreWeek: 1.5,
  /** Expansión: lo vende a lo sumo esta fracción de las tiendas activas… */
  maxCoverage: 0.3,
  /** …con al menos este ritmo por tienda (pedidos por día)… */
  minPerStoreDay: 0.5,
  /** …y al menos estas tiendas que todavía no lo venden. */
  minMissing: 3,
  minOrders: 20,
  /** En racha: crecimiento de 7 días vs. los 7 anteriores. */
  hotChange: 0.5,
  hotMinOrders7: 5,
} as const;

export type Trend = "strong" | "growing" | "stable" | "declining" | "falling" | "new" | "low" | "none";

export const TREND: Record<Trend, { label: string; tone: string; hint: string }> = {
  strong: { label: "🔥 Fuerte", tone: "accent", hint: "Pedidos de 7 días al menos 35% arriba de los 7 anteriores" },
  growing: { label: "Creciendo", tone: "success", hint: "Más de 15% arriba de los 7 días anteriores" },
  stable: { label: "Estable", tone: "info", hint: "Variación entre −15% y +15%" },
  declining: { label: "Bajando", tone: "warning", hint: "Más de 15% abajo de los 7 días anteriores" },
  falling: { label: "Cayendo", tone: "danger", hint: "Al menos 35% abajo de los 7 días anteriores" },
  new: { label: "Nuevo", tone: "accent", hint: "Tiene pedidos esta semana y no la anterior" },
  low: { label: "Poco volumen", tone: "neutral", hint: "Menos de 6 pedidos en dos semanas: el % no es confiable" },
  none: { label: "Sin pedidos", tone: "neutral", hint: "Sin pedidos en los últimos 14 días" },
};

const DAY = 86_400_000;

/** Variación de 7 días vs. los 7 anteriores (null si no hay base). */
export const change = (p: Pick<ProductPerf, "orders7" | "prev7">) => (p.prev7 > 0 ? (p.orders7 - p.prev7) / p.prev7 : null);

export function trend(p: Pick<ProductPerf, "orders7" | "prev7">): Trend {
  const R = PRODUCT_RULES;
  if (p.orders7 + p.prev7 === 0) return "none";
  if (p.prev7 === 0) return "new";
  if (p.orders7 + p.prev7 < R.minVolume) return "low";
  const c = change(p)!;
  if (c >= R.strong) return "strong";
  if (c > R.up) return "growing";
  if (c <= -R.strong) return "falling";
  if (c < R.down) return "declining";
  return "stable";
}

/** Días disponible: alta en el catálogo o, si no hay, primer pedido. null si no se sabe. */
export function ageDays(p: Pick<ProductPerf, "created_at" | "first_order_at">, now = Date.now()): number | null {
  const iso = p.created_at ?? p.first_order_at;
  if (!iso) return null;
  return Math.max(0, Math.floor((now - Date.parse(iso)) / DAY));
}

/** Pedidos promedio por tienda que lo vende (30 días). */
export const perStore = (p: Pick<ProductPerf, "orders30" | "stores30">) => (p.stores30 > 0 ? p.orders30 / p.stores30 : 0);

/** Pedidos por día por tienda que lo vende; si tiene menos de 30 días, sobre los días que lleva disponible. */
export function perStoreDay(p: ProductPerf, now = Date.now()) {
  const age = ageDays(p, now);
  const days = Math.min(30, Math.max(1, age ?? 30));
  return perStore(p) / days;
}

export const unitsPerOrder = (p: Pick<ProductPerf, "orders30" | "units30">) => (p.orders30 > 0 ? p.units30 / p.orders30 : null);

/** Fracción de las tiendas activas de la cuenta que lo venden. */
export const coverage = (p: Pick<ProductPerf, "stores30" | "active_stores30">) =>
  p.active_stores30 > 0 ? p.stores30 / p.active_stores30 : 0;

/** Se puede empujar: no está inactivo ni sin inventario. */
const sellable = (p: ProductPerf) => p.status !== "Inactivo" && (p.stock === null || p.stock > 0);

export type OpportunityKind = "expansion" | "hot" | "low_movement" | "no_orders";

export type ProductOpportunity = {
  kind: OpportunityKind;
  account_id: string;
  product_key: string;
  product_name: string;
  title: string;
  detail: string;
  action: string;
  /** 0–100: más alto, más urgente. */
  priority: number;
};

const n1 = (x: number) => (x >= 10 ? Math.round(x).toString() : x.toFixed(1));
const pct = (x: number) => `${x > 0 ? "+" : ""}${Math.round(x * 100)}%`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const clamp = (x: number) => Math.round(Math.max(0, Math.min(100, x)));

/** Clasifica un producto (a lo sumo una oportunidad por producto; "en racha" gana a "expansión"). */
export function productOpportunity(p: ProductPerf, now = Date.now()): ProductOpportunity | null {
  const R = PRODUCT_RULES;
  const base = { account_id: p.account_id, product_key: p.product_key, product_name: p.name };
  const age = ageDays(p, now);
  const missing = Math.max(0, p.active_stores30 - p.stores30);

  if (p.orders30 === 0) {
    if (p.status !== "Activo" || !(p.stock !== null && p.stock > 0) || age === null || age < R.minAgeDays) return null;
    return {
      ...base, kind: "no_orders",
      title: "Sin pedidos en 30 días",
      detail: `${age} días disponible · ${p.stock} u. en inventario · ninguna tienda lo vende`,
      action: "Presentarlo en la comunidad con creativo y oferta; si no arranca, evaluar dejar de importarlo",
      priority: clamp(25 + Math.min(p.stock, 200) / 10),
    };
  }

  const c = change(p);
  const cov = coverage(p);
  if (sellable(p) && c !== null && c >= R.hotChange && p.orders7 >= R.hotMinOrders7 && p.orders7 + p.prev7 >= R.minVolume && cov <= R.maxCoverage) {
    return {
      ...base, kind: "hot",
      title: "Producto en racha",
      detail: `${pct(c)} en 7 días (${p.prev7} → ${p.orders7} pedidos) · solo ${p.stores30} de ${p.active_stores30} tiendas lo venden`,
      action: "Avisar hoy a la comunidad: compartir los creativos, la landing y la oferta que ya le funcionan",
      priority: clamp(70 + Math.min(20, c * 10) + Math.min(10, missing / 3)),
    };
  }

  const psd = perStoreDay(p, now);
  if (sellable(p) && p.orders30 >= R.minOrders && psd >= R.minPerStoreDay && cov <= R.maxCoverage && missing >= R.minMissing && trend(p) !== "falling") {
    const potential = psd * missing;
    return {
      ...base, kind: "expansion",
      title: "Potencial de expansión",
      detail: `Solo ${plural(p.stores30, "tienda lo vende", "tiendas lo venden")} · ${n1(psd)} pedidos/día por tienda · ${plural(missing, "tienda todavía no lo vende", "tiendas todavía no lo venden")}`,
      action: "Promocionarlo en la comunidad con creativos, landing y oferta recomendada",
      priority: clamp(50 + Math.min(40, 10 * Math.log10(1 + potential))),
    };
  }

  // si viene subiendo fuerte no se marca como bajo movimiento (ya está reaccionando)
  const t = trend(p);
  if (age !== null && age >= R.minAgeDays && psd * 7 < R.lowPerStoreWeek && t !== "strong" && t !== "growing" && t !== "new") {
    return {
      ...base, kind: "low_movement",
      title: "Bajo movimiento",
      detail: `${age} días disponible · ${plural(p.stores30, "tienda lo vende", "tiendas lo venden")} · ${(psd * 7).toFixed(1)} pedidos/tienda/semana`,
      action: causeText(lowMovementCauses(p)[0]),
      priority: clamp(30 + Math.min(30, p.stores30 * 4)),
    };
  }
  return null;
}

/** Oportunidades de todos los productos, de más a menos urgente. */
export function productInsights(rows: ProductPerf[], now = Date.now()): ProductOpportunity[] {
  return rows
    .map((p) => productOpportunity(p, now))
    .filter((o): o is ProductOpportunity => o !== null)
    .sort((a, b) => b.priority - a.priority);
}

export type Cause = { key: "creative" | "offer" | "price" | "landing" | "product"; cause: string; action: string };

const CAUSES: Record<Cause["key"], Cause> = {
  creative: { key: "creative", cause: "Creativo", action: "cambiar los anuncios (nuevo gancho, video UGC)" },
  offer: { key: "offer", cause: "Oferta", action: "crear una oferta 2x o 3x" },
  price: { key: "price", cause: "Precio", action: "revisar el precio sugerido frente a la competencia" },
  landing: { key: "landing", cause: "Landing", action: "mejorar el argumento de venta de la landing" },
  product: { key: "product", cause: "Producto", action: "evaluar dejar de importarlo" },
};

/** Causas en el orden por defecto (creativo, oferta, precio, landing, producto). */
export const LOW_MOVEMENT_CAUSES = (): Cause[] => Object.values(CAUSES);

export const causeText = (c: Cause) => `Revisar ${c.cause.toLowerCase()}: ${c.action}`;

/** Causas probables de bajo movimiento, en orden de qué revisar primero. */
export function lowMovementCauses(p: ProductPerf): Cause[] {
  const order: Cause["key"][] = ["creative", "offer", "price", "landing", "product"];
  const move = (k: Cause["key"], to: number) => {
    order.splice(order.indexOf(k), 1);
    order.splice(to, 0, k);
  };
  // muchas tiendas lo probaron y ninguna lo mueve: pesa más el precio que el creativo de una tienda
  if (p.stores30 >= 5) move("price", 0);
  // casi siempre 1 unidad por pedido: la oferta es lo primero
  const upo = unitsPerOrder(p);
  if (upo !== null && upo < 1.15) move("offer", 0);
  return order.map((k) => CAUSES[k]);
}

export const PRODUCT_SORTS = {
  orders30_desc: "Más pedidos (30 días)",
  orders7_desc: "Más pedidos (7 días)",
  rise: "Mayor crecimiento",
  drop: "Mayor caída",
  stores_desc: "Más tiendas",
  stores_asc: "Menos tiendas",
  per_store_desc: "Más pedidos por tienda",
  units_desc: "Más unidades",
  ticket_desc: "Ticket más alto",
  ticket_asc: "Ticket más bajo",
  upo_desc: "Más unidades por pedido",
  upo_asc: "Menos unidades por pedido",
} as const;
export type ProductSort = keyof typeof PRODUCT_SORTS;

export function sortProducts(rows: ProductPerf[], sort: ProductSort): ProductPerf[] {
  const nz = (v: number | null, empty: number) => (v === null ? empty : v);
  const key: Record<ProductSort, (p: ProductPerf) => number> = {
    orders30_desc: (p) => -p.orders30,
    orders7_desc: (p) => -p.orders7,
    // en pedidos ganados/perdidos por semana, para que pese el volumen y no solo el %
    rise: (p) => -(p.orders7 - p.prev7),
    drop: (p) => p.orders7 - p.prev7,
    stores_desc: (p) => -p.stores30,
    stores_asc: (p) => (p.orders30 ? p.stores30 : Infinity),
    per_store_desc: (p) => -perStore(p),
    units_desc: (p) => -p.units30,
    ticket_desc: (p) => -nz(p.ticket, -Infinity),
    ticket_asc: (p) => nz(p.ticket, Infinity),
    upo_desc: (p) => -nz(unitsPerOrder(p), -Infinity),
    upo_asc: (p) => nz(unitsPerOrder(p), Infinity),
  };
  const k = key[sort];
  return [...rows].sort((a, b) => k(a) - k(b) || b.orders30 - a.orders30);
}
