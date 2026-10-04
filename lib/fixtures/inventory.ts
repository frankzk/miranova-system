// Simulación local de inventory_status: salidas = unidades de pedidos no cancelados, devoluciones = no entregados.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FixtureCtx, FixtureModule, Row } from "./types";

function inventoryStatus(args: Row, ctx: FixtureCtx) {
  const rows = baseStatus(args, ctx);
  // para ver en local los estados de "Qué pedir": el que más sale, agotado; el segundo, con ~3 días
  const top = [...rows].filter((r) => r.out14 > 0).sort((a, b) => b.out14 - a.out14);
  if (top[0]) top[0].stock = 0;
  if (top[1]) top[1].stock = Math.max(1, Math.round((top[1].out14 / 14) * 3));
  return rows;
}

function baseStatus(args: Row, { ORDERS, ACCOUNTS, CATALOG, DAY, groupOf }: FixtureCtx) {
  const now = Date.now();
  return CATALOG.filter((p) => !args.p_account || p.account_id === args.p_account).map((p) => {
    const lines = ORDERS.filter((o) => o.account_id === p.account_id && groupOf(o.status_code) !== "cancelled")
      .flatMap((o) => (o.order_items ?? []).filter((i: any) => i.product_name === p.name).map((i: any) => ({ o, q: i.quantity })));
    const within = (days: number, pred: (o: Row) => boolean) =>
      lines.filter(({ o }) => now - Date.parse(o.ordered_at) <= days * DAY && pred(o)).reduce((t, x) => t + x.q, 0);
    const failed = (o: Row) => groupOf(o.status_code) === "failed";
    const daily = Array.from({ length: 30 }, (_, i) =>
      lines.filter(({ o }) => Math.floor((now - Date.parse(o.ordered_at)) / DAY) === 29 - i).reduce((t, x) => t + x.q, 0));
    return {
      account_id: p.account_id, account_name: ACCOUNTS.find((a) => a.id === p.account_id)?.name, external_id: p.external_id,
      code: p.code, name: p.name, status: p.status, image_url: p.image_url, stock: p.stock ?? 0, variants_count: p.variants_count,
      out14: within(14, () => true), ret14: within(14, failed), out30: within(30, () => true), ret30: within(30, failed),
      last_out_at: lines.map(({ o }) => o.ordered_at).sort().pop() ?? null, first_at: null,
      last_restock_at: new Date(now - 12 * DAY).toISOString(),
      restocks: [{ at: new Date(now - 12 * DAY).toISOString(), units: 120, reason: "STOCK_REQUEST" }, { at: new Date(now - 40 * DAY).toISOString(), units: 200, reason: "INITIAL_STOCK" }],
      pending_orders: lines.filter(({ o }) => groupOf(o.status_code) === "dispatch").length,
      daily,
    };
  });
}

// pedidos de reposición ("Ya lo pedí") y tiempos fijados a mano: empiezan vacíos y se llenan desde el panel
export const fixtures: FixtureModule = { rpc: { inventory_status: inventoryStatus }, tables: { restock_orders: [], product_lead_times: [] } };
