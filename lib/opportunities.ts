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
  subject: { type: "store" | "product"; name: string; account_id: string; account_name: string; store_id?: string; product_key?: string };
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

/** Orden de la lista: prioridad y, dentro de ella, lo que más pedidos mueve. */
export function sortOpportunities(items: OppItem[]): OppItem[] {
  return [...items].sort((a, b) => a.priority - b.priority || b.weight - a.weight || a.subject.name.localeCompare(b.subject.name, "es"));
}
