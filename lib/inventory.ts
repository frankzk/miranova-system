// Inventario: cuándo pedir y cuánto, por producto, contando lo que tarda en llegar una reposición.
// Datos de la función SQL `inventory_status` (movimientos de Drop + catálogo) y de los pedidos de
// reposición que se registran en el panel ("Ya lo pedí"). Puro, para probarlo.

export type Restock = { at: string; units: number; reason: string };

export type InventoryRow = {
  account_id: string;
  account_name: string;
  external_id: string;
  code: string | null;
  name: string;
  status: string | null;
  image_url: string | null;
  stock: number;
  variants_count: number;
  /** unidades que salieron por pedido / volvieron por devolución */
  out14: number;
  ret14: number;
  out30: number;
  ret30: number;
  last_out_at: string | null;
  first_at: string | null;
  last_restock_at: string | null;
  restocks: Restock[];
  /** pedidos por despachar que llevan el producto */
  pending_orders: number;
  /** salida neta por día, últimos 30 días (el último es hoy) */
  daily: number[];
};

/** Reposición pedida al proveedor y registrada en el panel ("Ya lo pedí"). */
export type RestockOrder = {
  id: string;
  account_id: string;
  product_external_id: string;
  units: number;
  ordered_at: string;
  /** llegada estimada, YYYY-MM-DD */
  eta: string | null;
  note: string | null;
  cancelled_at: string | null;
};

/** Pedidos registrados y tiempos de reposición fijados a mano (clave `cuenta:producto`). */
export type Supply = { orders: RestockOrder[]; leads: Map<string, number> };
export const NO_SUPPLY: Supply = { orders: [], leads: new Map() };
export const productKey = (accountId: string, externalId: string) => `${accountId}:${externalId}`;

export const REORDER = {
  /** Días que tarda una reposición si no hay otro dato: del aviso a la entrada en Drop pasaron
   *  ~8 días (mediana de los quiebres por ventas, ago–sep 2026). */
  defaultLead: 8,
  /** Lo que se pide cubre el tiempo de reposición, el colchón y estos días de venta. */
  cover: 30,
  /** Colchón para ~95 % de los días: z × variación diaria × √(días de reposición). */
  z: 1.65,
  /** Variación mínima supuesta: con pauta la venta cambia rápido (antes de agotarse se vendía
   *  1.9× el promedio de 14 días), así que nunca se asume menos de la mitad de la venta diaria. */
  minSpread: 0.5,
  /** "Pedir esta semana": llega al punto de pedido en estos días. */
  soon: 7,
  maxLead: 180,
};

export const INVENTORY_RULES = { highReturns: 0.2, minForReturns: 20 };

const DAY = 86_400_000;
const sum = (xs: number[]) => xs.reduce((t, v) => t + v, 0);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Fecha YYYY-MM-DD más `n` días. */
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** Días enteros de `a` a `b` (YYYY-MM-DD). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const utcToday = () => new Date().toISOString().slice(0, 10);

/** Salida neta por día (salidas − devoluciones, promedio de 14 días). */
export const perDay = (r: Pick<InventoryRow, "out14" | "ret14">) => Math.max(0, r.out14 - r.ret14) / 14;

/** Salida neta por día de los últimos 7 días completos (sin hoy, que va a medias). */
export function perDay7(r: Pick<InventoryRow, "daily">): number {
  const d = r.daily ?? [];
  const week = d.length >= 8 ? d.slice(-8, -1) : d.slice(-7);
  return week.length ? Math.max(0, sum(week)) / 7 : 0;
}

/** Venta diaria para planear: la más alta entre 7 y 14 días, para no quedarse corto cuando sube. */
export const demand = (r: Pick<InventoryRow, "out14" | "ret14" | "daily">) => Math.max(perDay(r), perDay7(r));

/** Cuánto varía la venta de un día a otro (desviación estándar de los últimos 14 días completos). */
export function dailySpread(r: Pick<InventoryRow, "daily">): number {
  const xs = (r.daily ?? []).slice(-15, -1).map((v) => Math.max(0, v));
  if (xs.length < 2) return 0;
  const mean = sum(xs) / xs.length;
  return Math.sqrt(sum(xs.map((v) => (v - mean) ** 2)) / (xs.length - 1));
}

/** Devoluciones sobre salidas en 30 días (null con poca muestra). */
export function returnRate(r: Pick<InventoryRow, "out30" | "ret30">): number | null {
  return r.out30 >= INVENTORY_RULES.minForReturns ? r.ret30 / r.out30 : null;
}

/** Redondeo hacia arriba fácil de pedir: de 5 en 5 desde 20 u., de 10 en 10 desde 100. */
export function niceUp(n: number): number {
  if (!(n > 0)) return 0;
  const step = n >= 100 ? 10 : n >= 20 ? 5 : 1;
  return Math.ceil(n / step) * step;
}

export type OrderStatus = "open" | "late" | "arrived" | "cancelled";
export type TrackedOrder = RestockOrder & { status: OrderStatus; arrived_at: string | null; arrived_units: number | null };

/**
 * Estado de cada pedido: llegó cuando Drop registra una entrada de mercadería (solicitud de stock,
 * stock inicial o ajuste de entrada) después de pedirlo; cada entrada cierra un solo pedido, el
 * más antiguo. Sin entrada y con la fecha estimada vencida, está atrasado.
 */
export function trackOrders(orders: RestockOrder[], restocks: Restock[], today: string): TrackedOrder[] {
  const ins = [...restocks].filter((x) => x.units > 0).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const used = new Set<number>();
  return [...orders]
    .sort((a, b) => Date.parse(a.ordered_at) - Date.parse(b.ordered_at))
    .map((o): TrackedOrder => {
      if (o.cancelled_at) return { ...o, status: "cancelled", arrived_at: null, arrived_units: null };
      const i = ins.findIndex((x, k) => !used.has(k) && Date.parse(x.at) > Date.parse(o.ordered_at));
      if (i >= 0) {
        used.add(i);
        return { ...o, status: "arrived", arrived_at: ins[i].at, arrived_units: ins[i].units };
      }
      return { ...o, status: o.eta && o.eta < today ? "late" : "open", arrived_at: null, arrived_units: null };
    });
}

export type LeadSource = "manual" | "measured" | "default";
export const LEAD_SOURCE: Record<LeadSource, string> = { manual: "fijado a mano", measured: "medido", default: "estándar" };

/** Días de reposición: el fijado a mano; si no, lo que tardaron los pedidos que ya llegaron; si no, el estándar. */
export function leadTime(key: string, tracked: TrackedOrder[], supply: Supply): { days: number; source: LeadSource; samples: number } {
  const took = tracked.filter((o) => o.status === "arrived").map((o) => (Date.parse(o.arrived_at!) - Date.parse(o.ordered_at)) / DAY);
  const manual = supply.leads.get(key);
  if (manual) return { days: manual, source: "manual", samples: took.length };
  if (took.length) return { days: Math.min(REORDER.maxLead, Math.max(1, Math.round(median(took)))), source: "measured", samples: took.length };
  return { days: REORDER.defaultLead, source: "default", samples: 0 };
}

export type ReorderLevel = "out" | "now" | "soon" | "ok" | "idle";

export const REORDER_LEVEL: Record<ReorderLevel, { label: string; tone: string; hint: string }> = {
  out: { label: "Agotado", tone: "danger", hint: "Sin existencia y con salidas recientes o pedidos esperando" },
  now: { label: "Pedir hoy", tone: "danger", hint: "Lo que hay más lo que viene no alcanza mientras llega una reposición" },
  soon: { label: "Pedir esta semana", tone: "warning", hint: `Llega al punto de pedido en los próximos ${REORDER.soon} días` },
  ok: { label: "Al día", tone: "success", hint: `Alcanza para el tiempo de reposición y el colchón por más de ${REORDER.soon} días` },
  idle: { label: "Sin movimiento", tone: "neutral", hint: "Tiene existencia pero no salió nada en 14 días" },
};
export const LEVEL_ORDER: ReorderLevel[] = ["out", "now", "soon", "ok", "idle"];

export type ReorderPlan = {
  level: ReorderLevel;
  /** venta diaria para planear y sus dos fuentes */
  demand: number;
  rate7: number;
  rate14: number;
  lead: number;
  leadSource: LeadSource;
  leadSamples: number;
  /** colchón (u.) por lo que varía la venta mientras llega */
  safety: number;
  /** punto de pedido: al bajar de aquí (existencia + en camino), hay que pedir */
  reorderPoint: number;
  inTransit: number;
  /** existencia + en camino */
  position: number;
  /** pedidos de este producto, del más antiguo al más nuevo */
  orders: TrackedOrder[];
  /** los que siguen en camino (a tiempo o atrasados) */
  open: TrackedOrder[];
  /** días que alcanza la existencia sola (null si no sale nada) */
  daysLeft: number | null;
  /** día en que se agota sin reposición */
  stockoutOn: string | null;
  /** días que faltan para el punto de pedido (≤ 0: ya pasó) */
  slack: number | null;
  /** fecha límite para pedir */
  orderBy: string | null;
  /** hay que pedir hoy o esta semana (con lo que ya viene no alcanza) */
  needsOrder: boolean;
  /** unidades sugeridas: cubren la reposición, el colchón y 30 días de venta */
  qty: number;
  /** días sin existencia si lo que viene llega después de agotarse */
  gapDays: number | null;
};

export function reorderPlan(r: InventoryRow, supply: Supply = NO_SUPPLY, today: string = utcToday()): ReorderPlan {
  const key = productKey(r.account_id, r.external_id);
  const orders = trackOrders(supply.orders.filter((o) => productKey(o.account_id, o.product_external_id) === key), r.restocks ?? [], today);
  const open = orders.filter((o) => o.status === "open" || o.status === "late");
  const inTransit = sum(open.map((o) => o.units));
  const stock = Math.max(0, r.stock);
  const position = stock + inTransit;
  const rate14 = perDay(r);
  const rate7 = perDay7(r);
  const d = Math.max(rate14, rate7);
  const lt = leadTime(key, orders, supply);
  const base = { demand: d, rate7, rate14, lead: lt.days, leadSource: lt.source, leadSamples: lt.samples, inTransit, position, orders, open };

  if (d <= 0) {
    const out = stock <= 0 && (r.pending_orders > 0 || r.out30 > 0);
    return {
      ...base, level: out ? "out" : "idle", safety: 0, reorderPoint: 0, daysLeft: null, stockoutOn: null, slack: null,
      orderBy: null, needsOrder: false, qty: 0, gapDays: null,
    };
  }

  const safety = Math.ceil(REORDER.z * Math.max(dailySpread(r), REORDER.minSpread * d) * Math.sqrt(lt.days));
  const reorderPoint = Math.ceil(d * lt.days) + safety;
  const daysLeft = stock / d;
  const stockoutOn = addDays(today, Math.floor(daysLeft));
  const slack = (position - reorderPoint) / d;
  const needsOrder = slack <= REORDER.soon;
  const level: ReorderLevel = stock <= 0 ? "out" : slack <= 0 ? "now" : needsOrder ? "soon" : "ok";
  // pedir ahora cubre lo que falta para el punto de pedido; pedir a tiempo, 30 días más de venta
  const qty = niceUp(d * (lt.days + REORDER.cover) + safety - Math.min(position, reorderPoint));
  const etas = open.map((o) => o.eta).filter((e): e is string => Boolean(e)).sort();
  const gapDays = etas.length && etas[0] > stockoutOn ? daysBetween(stockoutOn, etas[0]) : null;

  return {
    ...base, level, safety, reorderPoint, daysLeft, stockoutOn, slack,
    orderBy: addDays(today, Math.max(0, Math.floor(slack))), needsOrder, qty, gapDays,
  };
}

/** Orden de urgencia: agotados sin reposición suficiente, luego lo que menos margen tiene para pedir. */
export function urgency(p: ReorderPlan): number {
  if (p.level === "out") return -1_000_000 - p.demand + (p.needsOrder ? 0 : 500_000);
  if (p.level === "idle" || p.slack === null) return Infinity;
  return p.slack;
}

export type InventoryAlert = { kind: "stockout" | "low_stock" | "returns"; account_id: string; product_key: string; product_name: string; title: string; detail: string; action: string; priority: number };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const shortDay = (day: string) => {
  const [, m, d] = day.split("-").map(Number);
  return `${d}/${m}`;
};

/** Alertas para Oportunidades: agotados con demanda, qué pedir hoy o esta semana y devoluciones altas. */
export function inventoryAlerts(rows: InventoryRow[], supply: Supply = NO_SUPPLY, today: string = utcToday()): InventoryAlert[] {
  const out: InventoryAlert[] = [];
  for (const r of rows) {
    const p = reorderPlan(r, supply, today);
    const base = { account_id: r.account_id, product_key: r.external_id, product_name: r.name };
    const late = p.open.filter((o) => o.status === "late");
    const coming = p.inTransit
      ? ` · vienen ${p.inTransit} u.${p.open[0]?.eta ? ` (llegada ${shortDay(p.open[0].eta)})` : ""}${late.length ? `, ${plural(late.length, "pedido atrasado", "pedidos atrasados")}` : ""}`
      : "";
    if (p.level === "out" && (p.demand > 0 || r.pending_orders > 0)) {
      out.push({
        ...base, kind: "stockout",
        title: "Agotado con demanda",
        detail: `${p.demand.toFixed(1)} u./día${r.pending_orders ? ` · ${r.pending_orders} pedidos esperando despacho` : ""}${coming}`,
        action: p.needsOrder && p.qty > 0
          ? `pedir ya unas ${p.qty} u. (tarda ~${plural(p.lead, "día", "días")}); mientras, avisar a las tiendas que lo venden`
          : p.inTransit > 0
            ? "la reposición ya viene; mientras, avisar a las tiendas que lo venden"
            : "reponer: hay pedidos esperando despacho",
        priority: 100 + p.demand,
      });
    } else if (p.level === "now" || p.level === "soon") {
      const days = Math.floor(p.daysLeft!);
      out.push({
        ...base, kind: "low_stock",
        title: p.level === "now" ? `Pedir hoy: se agota en ${days < 1 ? "menos de 1 día" : plural(days, "día", "días")}` : `Pedir antes del ${shortDay(p.orderBy!)}`,
        detail: `${r.stock} u. · ${p.demand.toFixed(1)} u./día · la reposición tarda ~${plural(p.lead, "día", "días")}${coming}`,
        action: `pedir unas ${p.qty} u. para cubrir la reposición y 30 días de venta`,
        priority: p.level === "now" ? 60 + p.demand : 40 + (REORDER.soon - p.slack!) * 2,
      });
    }
    const rr = returnRate(r);
    if (rr !== null && rr >= INVENTORY_RULES.highReturns) {
      out.push({
        ...base, kind: "returns",
        title: `Devoluciones altas: ${Math.round(rr * 100)}%`,
        detail: `${r.ret30} de ${r.out30} u. volvieron en 30 días`,
        action: "revisar confirmación de pedidos, promesa del anuncio y calidad del producto",
        priority: 20 + rr * 50,
      });
    }
  }
  return out.sort((a, b) => b.priority - a.priority);
}
