// "Atención del dueño": convierte las alertas que calcula la base (owner_alerts)
// en una línea legible con su enlace. Los umbrales viven en la migración 0009.

import { fmtInt, fmtMoney, fmtShort } from "./format.ts";

export type AlertKind =
  | "account_stalled" | "account_drop" | "account_growth"
  | "store_inactive" | "store_drop"
  | "product_growth" | "stock_rejections" | "product_delivery"
  | "stuck_orders" | "carrier_delivery" | "unpaid_late";

export type OwnerAlert = {
  kind: AlertKind;
  /** 1 = hoy, 2 = esta semana, 3 = oportunidad */
  severity: 1 | 2 | 3;
  account_id: string;
  account: string;
  country: string;
  currency: string;
  data: Record<string, unknown>;
};

export type OwnerAlerts = { total: number; alerts: OwnerAlert[] };

export type AlertView = {
  tone: "danger" | "warning" | "info";
  /** texto visible junto al color, para no depender solo de él */
  tag: string;
  title: string;
  detail: string;
  href: string;
};

const TONE = { 1: "danger", 2: "warning", 3: "info" } as const;
const TAG = { 1: "Hoy", 2: "Esta semana", 3: "Oportunidad" } as const;

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const pctChange = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
// espacios no separables: "61 %" o "L 21,480.50" no deben partirse en dos líneas
const NBSP = "\u00a0";
const signed = (p: number) => `${p > 0 ? "+" : "−"}${Math.abs(p)}${NBSP}%`;
const pct = (r: number) => `${Math.round(r * 100)}${NBSP}%`;
const money = (n: number, currency: string) => fmtMoney(n, currency).replace(" ", NBSP);

/** Cambia la cuenta activa del panel y abre `next` (como los chips de cuenta). */
const inAccount = (account: string, next: string) => `/api/scope?${new URLSearchParams({ account, next })}`;

export function describeAlert(a: OwnerAlert, tz?: string): AlertView {
  const d = a.data;
  const cur = num(d.cur);
  const prev = num(d.prev);
  const change = pctChange(cur, prev);
  const base = { tone: TONE[a.severity], tag: TAG[a.severity] };

  switch (a.kind) {
    case "account_stalled":
      return {
        ...base,
        title: `${a.account}: 0 pedidos en 7 días`,
        detail: `La semana anterior tuvo ${fmtInt(prev)}. Último pedido: ${fmtShort(str(d.last_order), tz)}.`,
        href: inAccount(a.account_id, "/orders"),
      };
    case "account_drop":
    case "account_growth":
      return {
        ...base,
        title: `${a.account}: pedidos ${change === null ? "en alza" : signed(change)} esta semana`,
        detail: `${fmtInt(cur)} pedidos en 7 días frente a ${fmtInt(prev)} la semana anterior.`,
        href: inAccount(a.account_id, "/"),
      };
    case "store_inactive":
      return {
        ...base,
        title: `${str(d.store)} dejó de pedir`,
        detail: `${a.account} · sin pedidos desde el ${fmtShort(str(d.last_order), tz)}; hacía unos ${fmtInt(num(d.weekly))} por semana.`,
        href: `/orders?dropshipper=${encodeURIComponent(str(d.store))}`,
      };
    case "store_drop":
      return {
        ...base,
        title: `${str(d.store)}: ${change === null ? "cayó" : signed(change)} en 14 días`,
        detail: `${a.account} · ${fmtInt(cur)} pedidos frente a ${fmtInt(prev)} en las 2 semanas anteriores.`,
        href: `/orders?dropshipper=${encodeURIComponent(str(d.store))}`,
      };
    case "product_growth":
      return {
        ...base,
        title: `${str(d.product)}: ${change === null ? "producto nuevo en alza" : `${signed(change)} en 14 días`}`,
        detail: `${a.account} · ${fmtInt(cur)} unidades frente a ${fmtInt(prev)} en las 2 semanas anteriores.`,
        href: `/products?q=${encodeURIComponent(str(d.product))}`,
      };
    case "stock_rejections":
      return {
        ...base,
        title: `${str(d.product)}: ${fmtInt(num(d.orders))} pedidos rechazados por falta de stock`,
        detail: `${a.account} · últimos 7 días. Cada rechazo es una venta en riesgo.`,
        href: `/products?q=${encodeURIComponent(str(d.product))}`,
      };
    case "product_delivery":
      return {
        ...base,
        title: `${str(d.product)}: ${pct(num(d.rate))} de entrega`,
        detail: `${a.account} · promedio de la cuenta ${pct(num(d.avg))}; ${fmtInt(num(d.failed))} no entregados en 60 días.`,
        href: `/products?q=${encodeURIComponent(str(d.product))}`,
      };
    case "stuck_orders": {
      const transit = num(d.transit);
      const problem = num(d.problem);
      return {
        ...base,
        title: `${a.account}: ${fmtInt(num(d.orders))} pedidos sin moverse hace más de 5 días`,
        detail: `${fmtInt(transit)} en tránsito · ${fmtInt(problem)} con problemas · ${money(num(d.amount), a.currency)} en juego.`,
        href: inAccount(a.account_id, `/orders?group=${problem > transit ? "problem" : "transit"}`),
      };
    }
    case "carrier_delivery":
      return {
        ...base,
        title: `${str(d.carrier)}: ${pct(num(d.rate))} de entrega en ${a.account}`,
        detail: `Promedio de la cuenta ${pct(num(d.avg))}; ${fmtInt(num(d.failed))} no entregados de ${fmtInt(num(d.closed))} en 60 días.`,
        href: inAccount(a.account_id, `/orders?carrier=${encodeURIComponent(str(d.carrier))}`),
      };
    case "unpaid_late":
      return {
        ...base,
        title: `${a.account}: ${money(num(d.amount), a.currency)} entregados sin liquidar`,
        detail: `${fmtInt(num(d.orders))} pedidos entregados hace más de 3 días que la plataforma aún no paga.`,
        href: inAccount(a.account_id, "/money"),
      };
  }
}
