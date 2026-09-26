// Oportunidades: une las alertas comerciales de tiendas y productos en una sola lista de acciones
// para el equipo ("a quién contactar hoy y qué proponerle"). Puro, para poder probarlo.

import type { CrossSellItem } from "./cross-sell.ts";
import type { InventoryAlert } from "./inventory.ts";
import type { ProductOpportunity } from "./product-insights.ts";
import { opportunities, type OpportunityKind, type StoreRow } from "./stores.ts";

export type OppGroup = "contact" | "grow" | "ticket" | "product";

export const OPP_GROUPS: Record<OppGroup, { label: string; hint: string }> = {
  contact: { label: "Contactar hoy", hint: "Se frenaron o están cayendo" },
  grow: { label: "Hacer crecer", hint: "Crecen fuerte, dependen de un producto, venden uno solo o pueden probar otro" },
  ticket: { label: "Ticket y unidades", hint: "Pueden vender más por pedido con bundles y ofertas 2x/3x" },
  product: { label: "Productos", hint: "Agotados o por agotarse, en racha, con potencial de expansión, y los que no se mueven" },
};

export type OppItem = {
  /** estable para React: tipo + sujeto */
  id: string;
  group: OppGroup;
  kind: string;
  /** 1 = hoy, 2 = esta semana, 3 = cuando haya tiempo */
  priority: 1 | 2 | 3;
  /** peso para ordenar dentro de la misma prioridad (p. ej. pedidos en juego) */
  weight: number;
  subject: { type: "store" | "product" | "account"; name: string; account_id: string; account_name: string; store_id?: string; product_key?: string };
  title: string;
  action: string;
  /** dato de contexto corto: "49 pedidos en 7 días · 5/7 días activos" */
  meta: string;
  tone: "danger" | "warning" | "success" | "info" | "accent";
};

const GROUP_OF: Record<OpportunityKind, OppGroup> = {
  silent: "contact",
  volume: "contact",
  delivery: "contact",
  growth: "grow",
  single: "grow",
  winner: "grow",
  ticket: "ticket",
  units: "ticket",
};

const TONE_OF: Record<OpportunityKind, OppItem["tone"]> = {
  silent: "danger",
  volume: "danger",
  delivery: "warning",
  growth: "success",
  single: "info",
  winner: "info",
  ticket: "accent",
  units: "accent",
};

/** Una fila por alerta de tienda (una tienda puede tener varias: caída + ticket bajo). */
export function storeOpportunities(
  rows: StoreRow[],
  typical: Record<string, number | null>,
  fmt: (s: StoreRow) => (n: number) => string,
): OppItem[] {
  const out: OppItem[] = [];
  for (const s of rows) {
    const meta = [`${s.d7} pedidos en 7 días (antes ${s.prev7})`, `${s.active7}/7 días activos`, s.skus30 ? `${s.skus30} producto${s.skus30 > 1 ? "s" : ""}` : null]
      .filter(Boolean)
      .join(" · ");
    for (const o of opportunities(s, typical[s.account_id], fmt(s))) {
      // peso: pedidos en juego — lo que dejó de vender si cae, su volumen si es de crecimiento o ticket
      const weight = o.priority === 1 ? Math.max(s.prev7 - s.d7, s.prev7 / 7) : s.d7;
      out.push({
        id: `${o.kind}:${s.account_id}:${s.store_id}`,
        group: GROUP_OF[o.kind],
        kind: o.kind,
        priority: o.priority,
        weight,
        subject: { type: "store", name: s.name, account_id: s.account_id, account_name: s.account_name, store_id: s.store_id },
        title: o.text,
        action: o.action,
        meta,
        tone: TONE_OF[o.kind],
      });
    }
  }
  return out;
}

/**
 * Cuentas que se quedaron sin pedidos: si ninguna tienda de la cuenta vendió en 7 días y antes sí
 * vendían, el problema es de la cuenta (operación pausada, sincronización), no de cada tienda.
 */
export function stalledAccounts(rows: StoreRow[], min = 10): { account_id: string; account_name: string; prev7: number; stores: number; days: number | null }[] {
  const by = new Map<string, StoreRow[]>();
  for (const s of rows) by.set(s.account_id, [...(by.get(s.account_id) ?? []), s]);
  return [...by.values()]
    .map((xs) => ({
      account_id: xs[0].account_id,
      account_name: xs[0].account_name,
      d7: xs.reduce((t, s) => t + s.d7, 0),
      prev7: xs.reduce((t, s) => t + s.prev7, 0),
      stores: xs.filter((s) => s.prev7 > 0).length,
      days: Math.min(...xs.map((s) => s.days_since ?? Infinity)),
    }))
    .filter((a) => a.d7 === 0 && a.prev7 >= min)
    .map(({ d7: _d7, days, ...a }) => ({ ...a, days: Number.isFinite(days) ? days : null }));
}

/** Tiendas + cuentas detenidas (que reemplazan las alertas de "se frenó" de sus tiendas). */
export function allStoreOpportunities(
  rows: StoreRow[],
  typical: Record<string, number | null>,
  fmt: (s: StoreRow) => (n: number) => string,
): OppItem[] {
  const stalled = stalledAccounts(rows);
  const quiet = new Set(stalled.map((a) => a.account_id));
  const items = storeOpportunities(rows, typical, fmt).filter((i) => !(quiet.has(i.subject.account_id) && i.group === "contact"));
  for (const a of stalled) {
    items.push({
      id: `account:${a.account_id}`,
      group: "contact",
      kind: "account_stalled",
      priority: 1,
      weight: a.prev7 + 1_000_000, // antes que cualquier tienda
      subject: { type: "account", name: a.account_name, account_id: a.account_id, account_name: a.account_name },
      title: `Ninguna tienda vendió en 7 días${a.days !== null ? ` (último pedido hace ${a.days} días)` : ""}`,
      action: "revisar si la operación está pausada o si la cuenta dejó de recibir pedidos",
      meta: `${a.prev7} pedidos la semana anterior · ${a.stores} tiendas vendían`,
      tone: "danger",
    });
  }
  return items;
}

const PRODUCT_KIND: Record<ProductOpportunity["kind"], { priority: 2 | 3; tone: OppItem["tone"] }> = {
  hot: { priority: 2, tone: "success" },
  expansion: { priority: 2, tone: "accent" },
  low_movement: { priority: 3, tone: "warning" },
  no_orders: { priority: 3, tone: "warning" },
};

/** Productos: en racha, con potencial de expansión, de bajo movimiento o sin pedidos. */
export function productItems(ops: ProductOpportunity[], accountName: (id: string) => string): OppItem[] {
  return ops.map((o) => ({
    id: `${o.kind}:${o.account_id}:${o.product_key}`,
    group: "product" as const,
    kind: o.kind,
    priority: PRODUCT_KIND[o.kind].priority,
    weight: o.priority,
    subject: { type: "product" as const, name: o.product_name, account_id: o.account_id, account_name: accountName(o.account_id), product_key: o.product_key },
    title: o.title,
    action: o.action,
    meta: o.detail,
    tone: PRODUCT_KIND[o.kind].tone,
  }));
}

/**
 * Venta cruzada (de la matriz tienda × producto). Si la tienda ya tiene la alerta "vende un solo
 * producto", se le agrega el producto sugerido en vez de repetirla; una sugerencia por tienda.
 */
export function withCrossSell(items: OppItem[], cross: CrossSellItem[], accountName: (id: string) => string): OppItem[] {
  const out = [...items];
  const seen = new Set<string>();
  for (const c of cross) {
    const storeKey = `${c.account_id}:${c.store_id}`;
    if (c.kind === "single_product") {
      const i = out.findIndex((x) => x.kind === "single" && `${x.subject.account_id}:${x.subject.store_id}` === storeKey);
      if (i >= 0) {
        if (c.product_name) out[i] = { ...out[i], action: `ofrecerle un segundo producto: ${c.product_name}` };
        continue;
      }
    }
    if (seen.has(storeKey)) continue;
    seen.add(storeKey);
    out.push({
      id: `${c.kind}:${storeKey}:${c.product_key ?? ""}`,
      group: "grow",
      kind: c.kind,
      priority: 2,
      weight: c.priority,
      subject: { type: "store", name: c.store_name, account_id: c.account_id, account_name: accountName(c.account_id), store_id: c.store_id },
      title: c.kind === "cross_sell"
        ? `Vende mucho ${c.anchor_name} pero nunca probó ${c.product_name}`
        : c.title.replace(/^📦\s*/, ""),
      action: c.action.charAt(0).toLowerCase() + c.action.slice(1),
      meta: c.detail,
      tone: "info",
    });
  }
  return out;
}

const INVENTORY_KIND: Record<InventoryAlert["kind"], { priority: 1 | 2 | 3; tone: OppItem["tone"] }> = {
  stockout: { priority: 1, tone: "danger" },
  low_stock: { priority: 2, tone: "warning" },
  returns: { priority: 3, tone: "warning" },
};

/** Inventario: agotados con demanda (hoy), por agotarse (esta semana) y devoluciones altas. */
export function inventoryItems(alerts: InventoryAlert[], accountName: (id: string) => string): OppItem[] {
  return alerts.map((a) => ({
    id: `${a.kind}:${a.account_id}:${a.product_key}`,
    group: "product" as const,
    kind: a.kind,
    priority: INVENTORY_KIND[a.kind].priority,
    weight: a.priority,
    subject: { type: "product" as const, name: a.product_name, account_id: a.account_id, account_name: accountName(a.account_id), product_key: a.product_key },
    title: a.title,
    action: a.action,
    meta: a.detail,
    tone: INVENTORY_KIND[a.kind].tone,
  }));
}

/** Orden de la lista: prioridad y, dentro de ella, lo que más pedidos mueve. */
export function sortOpportunities(items: OppItem[]): OppItem[] {
  return [...items].sort((a, b) => a.priority - b.priority || b.weight - a.weight || a.subject.name.localeCompare(b.subject.name, "es"));
}
