// Privatizado sin pautar: tiendas con stock privatizado (exclusivo) que dejaron de pedir ese
// producto. Los hechos vienen de la función SQL `exclusive_idle` (una fila por cuenta, tienda y
// producto); aquí se clasifica, se agrupa por tienda y se arma el aviso, para poder probarlo.
//
// "Dejó de pautarlo 1 día" = ayer fue un día completo (hora local de la cuenta) sin pedidos de ese
// producto: hoy todavía puede llegar alguno, así que hoy no cuenta.

import type { OwnerAlert } from "./alerts.ts";
import { fmtInt } from "./format.ts";
import { fmtDay } from "./store-metrics.ts";
import type { StoreRow } from "./stores.ts";

export type ExclusiveIdleRow = {
  account_id: string;
  account_name: string;
  /** hoy en la zona de la cuenta (YYYY-MM-DD) */
  today: string;
  store_id: string;
  store_name: string;
  product_external_id: string;
  product_name: string;
  product_code: string | null;
  /** unidades privatizadas a la tienda */
  units: number;
  /** desde cuándo lo tiene apartado (sin que el saldo vuelva a 0) */
  since: string | null;
  held_days: number | null;
  /** su último pedido (no cancelado) de ese producto */
  last_at: string | null;
  last_day: string | null;
  /** días entre ese día y hoy (0 = hoy, 1 = ayer) */
  days_since: number | null;
  /** pedidos de ese producto desde que lo privatizó */
  orders_since: number;
  /** pedidos de ese producto en los últimos 7 días */
  n7: number;
  /** pedidos en los 14 días y días con pedidos en los 7 días que terminan en su último pedido */
  n14_before: number;
  active_before: number;
  /** último pedido de la tienda con cualquier producto */
  store_last_at: string | null;
  store_days_since: number | null;
  /** cuándo se leyeron por última vez los movimientos de ese producto */
  movements_sync_at: string | null;
};

export type ExclusiveState = "stopped" | "sleeping" | "fresh" | "ok";

export const EXCLUSIVE_STATES: Record<ExclusiveState, { label: string; tone: string; hint: string }> = {
  stopped: { label: "Dejó de pautar", tone: "danger", hint: "Vendía el producto privatizado y lleva al menos un día completo sin pedidos" },
  sleeping: { label: "Durmiendo", tone: "warning", hint: "Una semana o más sin pedidos del producto privatizado, o no lo vende desde que lo privatizó" },
  fresh: { label: "Recién privatizado", tone: "info", hint: "Lo privatizó hace menos de 3 días y todavía no lo vende" },
  ok: { label: "Al día", tone: "success", hint: "Tuvo pedidos de ese producto ayer u hoy" },
};

/** Umbrales (en un solo lugar para ajustarlos). */
export const EXCLUSIVE_RULES = {
  /** con menos unidades apartadas no avisa (quedan unas pocas) */
  minUnits: 5,
  /** días para estrenar lo recién privatizado antes de avisar */
  graceDays: 3,
  /** días completos sin pedidos para pasar de "Dejó de pautar" a "Durmiendo" */
  sleepingDays: 7,
  /** días con pedidos en la semana antes de frenarse para "contactar hoy" (vendía seguido) */
  regularDays: 4,
  /** durmiendo con esto o más: esta semana; con menos: cuando haya tiempo */
  bigUnits: 20,
};

export type ExclusiveItem = ExclusiveIdleRow & {
  state: ExclusiveState;
  /** días completos sin pedidos de ese producto, sin contar hoy (si no lo estrenó, desde que lo privatizó) */
  idle_days: number;
  /** no lo vendió desde que lo privatizó */
  never: boolean;
  /** avisa: dejó de pautar o durmiendo, con al menos `minUnits` apartadas */
  alert: boolean;
  /** 1 = contactar hoy, 2 = esta semana, 3 = cuando haya tiempo (null si no avisa) */
  priority: 1 | 2 | 3 | null;
  /** días que le alcanzaba lo apartado al ritmo de las 2 semanas antes de su último pedido */
  cover: number | null;
};

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

/** Normaliza lo que manda la base (los enteros pueden llegar como texto). */
export function normalizeExclusive(rows: Partial<ExclusiveIdleRow>[]): ExclusiveIdleRow[] {
  return rows.map((r) => ({
    ...(r as ExclusiveIdleRow),
    units: Number(r.units ?? 0),
    held_days: num(r.held_days),
    days_since: num(r.days_since),
    orders_since: Number(r.orders_since ?? 0),
    n7: Number(r.n7 ?? 0),
    n14_before: Number(r.n14_before ?? 0),
    active_before: Number(r.active_before ?? 0),
    store_days_since: num(r.store_days_since),
  }));
}

export function classifyExclusive(r: ExclusiveIdleRow): ExclusiveItem {
  const R = EXCLUSIVE_RULES;
  const never = r.orders_since === 0;
  let state: ExclusiveState;
  let idle: number;
  if (never) {
    const held = r.held_days ?? 0;
    idle = Math.max(0, held - 1);
    state = held < R.graceDays ? "fresh" : "sleeping";
  } else {
    idle = Math.max(0, (r.days_since ?? 0) - 1);
    state = idle === 0 ? "ok" : idle >= R.sleepingDays ? "sleeping" : "stopped";
  }
  const alert = (state === "stopped" || state === "sleeping") && r.units >= R.minUnits;
  const priority = !alert ? null : state === "stopped" ? (r.active_before >= R.regularDays ? 1 : 2) : r.units >= R.bigUnits ? 2 : 3;
  const cover = r.n14_before > 0 ? Math.round(r.units / (r.n14_before / 14)) : null;
  return { ...r, state, idle_days: idle, never, alert, priority, cover };
}

/** Más urgente primero: prioridad, luego "dejó de pautar" antes que "durmiendo", luego más unidades. */
export function compareItems(a: ExclusiveItem, b: ExclusiveItem): number {
  return (a.priority ?? 9) - (b.priority ?? 9)
    || Number(b.state === "stopped") - Number(a.state === "stopped")
    || b.units - a.units
    || a.product_name.localeCompare(b.product_name, "es");
}

export type StoreExclusive = {
  key: string;
  account_id: string;
  account_name: string;
  store_id: string;
  store_name: string;
  /** todo lo que tiene privatizado, lo más urgente primero */
  items: ExclusiveItem[];
  /** los productos que avisan */
  alerts: ExclusiveItem[];
  units: number;
  /** unidades privatizadas de los productos que avisan (sin pedidos) */
  idle_units: number;
  /** el producto más urgente (null si ninguno avisa) */
  worst: ExclusiveItem | null;
  priority: 1 | 2 | 3 | null;
  store_last_at: string | null;
  store_days_since: number | null;
};

/** Lo privatizado agrupado por tienda (clave = storeKey: `<cuenta>:<tienda>`). */
export function privatizedByStore(rows: ExclusiveIdleRow[]): Map<string, StoreExclusive> {
  const by = new Map<string, ExclusiveItem[]>();
  for (const r of rows) {
    if (!(r.units > 0)) continue;
    const k = `${r.account_id}:${r.store_id}`;
    by.set(k, [...(by.get(k) ?? []), classifyExclusive(r)]);
  }
  const out = new Map<string, StoreExclusive>();
  for (const [key, list] of by) {
    const items = [...list].sort(compareItems);
    const alerts = items.filter((i) => i.alert);
    const f = items[0];
    out.set(key, {
      key, account_id: f.account_id, account_name: f.account_name, store_id: f.store_id, store_name: f.store_name,
      items, alerts,
      units: items.reduce((t, i) => t + i.units, 0),
      idle_units: alerts.reduce((t, i) => t + i.units, 0),
      worst: alerts[0] ?? null,
      priority: alerts[0]?.priority ?? null,
      store_last_at: f.store_last_at,
      store_days_since: f.store_days_since,
    });
  }
  return out;
}

/** Tiendas que avisan, la más urgente primero. */
export function compareStores(a: StoreExclusive, b: StoreExclusive): number {
  if (a.worst && b.worst) {
    const c = (a.priority ?? 9) - (b.priority ?? 9) || Number(b.worst.state === "stopped") - Number(a.worst.state === "stopped");
    if (c) return c;
  } else if (a.worst || b.worst) return a.worst ? -1 : 1;
  return b.idle_units - a.idle_units || a.store_name.localeCompare(b.store_name, "es");
}

export function alertingStores(by: Map<string, StoreExclusive>): StoreExclusive[] {
  return [...by.values()].filter((s) => s.worst).sort(compareStores);
}

const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n === 1 ? one : many}`;

/** "1 día sin pedidos" / "no lo vende desde que lo privatizó hace 34 días" / "pedidos ayer". */
export function idleText(i: ExclusiveItem): string {
  if (i.state === "fresh") return i.held_days === 0 ? "lo privatizó hoy" : `lo privatizó hace ${plural(i.held_days ?? 0, "día", "días")}`;
  if (i.never) return `no lo vende desde que lo privatizó hace ${plural(i.held_days ?? 0, "día", "días")}`;
  if (i.state === "ok") return i.days_since === 0 ? "con pedidos hoy" : "con pedidos ayer";
  return `${plural(i.idle_days, "día", "días")} sin pedidos`;
}

/** "le alcanzaba para ~17 días" al ritmo que llevaba (null si no tenía ritmo). */
export function coverText(i: ExclusiveItem): string | null {
  if (i.cover === null) return null;
  return i.cover < 1 ? "le alcanzaba para menos de un día" : `le alcanzaba para ~${plural(i.cover, "día", "días")}`;
}

/** Último pedido de ese producto: "último pedido 1 nov" (o "sin pedidos en 6 meses"). */
export function lastOrderText(i: ExclusiveItem): string {
  return i.last_day ? `último pedido ${fmtDay(i.last_day, i.today)}` : "sin pedidos en 6 meses";
}

/** Qué hace la tienda con lo demás: ayuda a entender si pausó solo este producto o toda la pauta. */
export function storeContext(s: Pick<StoreExclusive, "store_days_since">, i: ExclusiveItem): string | null {
  const sd = s.store_days_since;
  if (sd === null) return "la tienda no tiene pedidos en 6 meses";
  // días desde lo último de este producto (si no lo estrenó, desde que lo privatizó)
  const own = i.never ? (i.held_days ?? Infinity) : (i.days_since ?? Infinity);
  if (sd < own) return sd <= 1 ? "la tienda sigue vendiendo otros productos" : `la tienda vendió otros productos hasta hace ${plural(sd, "día", "días")}`;
  return sd >= 2 ? `la tienda no tiene pedidos hace ${plural(sd, "día", "días")}` : null;
}

const ACTIONS: Record<"stopped" | "sleeping" | "never", string> = {
  stopped: "contactar: ¿pausó la pauta? ayudarla a reactivarla",
  sleeping: "proponer un plan para moverlo o liberar el stock",
  never: "confirmar si lo va a pautar; si no, liberar el stock",
};

export const itemAction = (i: ExclusiveItem) => ACTIONS[i.never ? "never" : i.state === "stopped" ? "stopped" : "sleeping"];

export type ExclusiveOp = { kind: "exclusive"; text: string; action: string; priority: 1 | 2 | 3 };

/** El aviso de la tienda (una línea), o null si nada de lo privatizado avisa. */
export function privatizedOp(s: StoreExclusive): ExclusiveOp | null {
  const w = s.worst;
  if (!w || !w.priority) return null;
  const lead = w.state === "stopped" ? "Dejó de pautar su privatizado" : "Privatizado durmiendo";
  const rest = s.alerts.length - 1;
  const more = rest > 0 ? ` · y ${plural(rest, "producto", "productos")} más sin pedidos (${fmtInt(s.idle_units - w.units)} u.)` : "";
  return { kind: "exclusive", text: `${lead}: ${w.product_name} (${fmtInt(w.units)} u.), ${idleText(w)}${more}`, action: itemAction(w), priority: w.priority };
}

/**
 * Suma el aviso de lo privatizado a los de la tienda sin reordenarlos: va después de los de igual o
 * mayor prioridad (no le quita el primer lugar a "Se frenó" o a una caída fuerte).
 */
export function insertOp<A extends { priority: number }, B extends { priority: number }>(ops: A[], op: B | null): (A | B)[] {
  if (!op) return ops;
  const at = ops.findIndex((o) => o.priority > op.priority);
  return at < 0 ? [...ops, op] : [...ops.slice(0, at), op, ...ops.slice(at)];
}

/**
 * Fila de Salud para una tienda con privatizado que no sale en la lista (sin pedidos en 60 días):
 * sin ventas recientes, solo para la pestaña "Privatizado sin pautar".
 */
export function idleStoreRow(x: StoreExclusive, currency: string): StoreRow {
  return {
    account_id: x.account_id, store_id: x.store_id, account_name: x.account_name, currency, name: x.store_name,
    today: 0, d7: 0, prev7: 0, active7: 0, active_prev7: 0,
    last_at: x.store_last_at, days_since: x.store_days_since,
    n30: 0, ticket: null, vendor_per_order: null, units_per_order: null, delivered30: 0, failed30: 0, sales30: null,
    skus30: 0, top_product: null, top_share: null, daily: Array<number>(14).fill(0),
  };
}

/**
 * El producto que da el estado de la tienda: el más urgente si alguno avisa; si no, el que tiene más
 * unidades (así 3 u. que dejó de pautar no se ven "Al día", y 2 u. sueltas no tapan 36 u. al día).
 */
export function leadItem(s: StoreExclusive): ExclusiveItem {
  // con las mismas unidades, lo que no se vende antes que lo nuevo, y lo nuevo antes que lo al día
  const rank: Record<ExclusiveState, number> = { stopped: 0, sleeping: 1, fresh: 2, ok: 3 };
  return s.worst ?? s.items.reduce((a, b) => (b.units > a.units || (b.units === a.units && rank[b.state] < rank[a.state]) ? b : a));
}

/** Estado de la tienda en texto (exportación): "Dejó de pautar", "Al día", "Dejó de pautar (no avisa: menos de 5 u.)"… */
export function stateText(s: StoreExclusive): string {
  const i = leadItem(s);
  const label = EXCLUSIVE_STATES[i.state].label;
  return !i.alert && (i.state === "stopped" || i.state === "sleeping") ? `${label} (no avisa: menos de ${EXCLUSIVE_RULES.minUnits} u.)` : label;
}

/** Pestaña "Privatizado sin pautar" sin otro orden elegido: la tienda más urgente primero. */
export function byUrgency<T extends { account_id: string; store_id: string }>(rows: T[], alerting: StoreExclusive[]): T[] {
  const rank = new Map(alerting.map((x, i) => [x.key, i]));
  const at = (s: T) => rank.get(`${s.account_id}:${s.store_id}`) ?? rank.size;
  return [...rows].sort((a, b) => at(a) - at(b));
}

/** Celda compacta: "25 u. · 1 día sin pedidos", "5 prod. · 1,082 u. sin pedidos" o, si nada avisa, "36 u.". */
export function cellText(s: StoreExclusive): string {
  const w = s.worst;
  if (!w) return s.items.length === 1 ? `${fmtInt(s.units)} u.` : `${fmtInt(s.items.length)} prod. · ${fmtInt(s.units)} u.`;
  if (s.alerts.length === 1) return `${fmtInt(w.units)} u. · ${w.never ? "sin estrenar" : idleText(w)}`;
  return `${fmtInt(s.alerts.length)} prod. · ${fmtInt(s.idle_units)} u. sin pedidos`;
}

/** Una línea por producto (para el título de la celda y la exportación). */
export function itemLine(i: ExclusiveItem): string {
  return `${i.product_name}: ${fmtInt(i.units)} u. · ${EXCLUSIVE_STATES[i.state].label.toLowerCase()} · ${idleText(i)}`;
}

/** Inicio: un aviso por cuenta con tiendas que dejaron de pautar o tienen su privatizado durmiendo. */
export function exclusiveAlerts(
  by: Map<string, StoreExclusive>,
  accounts: { id: string; name: string; country: string; currency: string }[],
): OwnerAlert[] {
  const out: OwnerAlert[] = [];
  for (const acc of accounts) {
    const list = alertingStores(by).filter((s) => s.account_id === acc.id);
    if (!list.length) continue;
    const stopped = list.filter((s) => s.alerts.some((i) => i.state === "stopped"));
    out.push({
      kind: "exclusive_idle",
      severity: Math.min(...list.map((s) => s.priority ?? 3)) as 1 | 2 | 3,
      account_id: acc.id,
      account: acc.name,
      country: acc.country,
      currency: acc.currency,
      data: {
        stores: list.length,
        stopped: stopped.length,
        sleeping: list.length - stopped.length,
        units: list.reduce((t, s) => t + s.idle_units, 0),
        names: (stopped.length ? stopped : list).slice(0, 3).map((s) => s.store_name),
      },
    });
  }
  return out;
}
