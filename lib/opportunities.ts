// Oportunidades: une las alertas comerciales de tiendas y productos en una sola lista de acciones
// para el equipo ("a quién contactar hoy y qué proponerle"). Puro, para poder probarlo.

import { opportunities, type OpportunityKind, type StoreRow } from "./stores.ts";

export type OppGroup = "contact" | "grow" | "ticket" | "product";

export const OPP_GROUPS: Record<OppGroup, { label: string; hint: string }> = {
  contact: { label: "Contactar hoy", hint: "Se frenaron o están cayendo" },
  grow: { label: "Hacer crecer", hint: "Crecen fuerte, dependen de un producto o venden uno solo" },
  ticket: { label: "Ticket y unidades", hint: "Pueden vender más por pedido con bundles y ofertas 2x/3x" },
  product: { label: "Productos", hint: "Productos para impulsar en la comunidad o revisar" },
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

/** Orden de la lista: prioridad y, dentro de ella, lo que más pedidos mueve. */
export function sortOpportunities(items: OppItem[]): OppItem[] {
  return [...items].sort((a, b) => a.priority - b.priority || b.weight - a.weight || a.subject.name.localeCompare(b.subject.name, "es"));
}
