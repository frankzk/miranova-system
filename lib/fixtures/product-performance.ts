// Simulación local de product_performance (Productos · Rendimiento).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FixtureCtx, FixtureModule, Row } from "./types";

function productPerformance(args: Row, { ORDERS, ACCOUNTS, CATALOG, DAY, groupOf, storeId, productKey, localDay }: FixtureCtx) {
  const now = Date.now();
  const age = (o: Row) => now - Date.parse(o.ordered_at);
  const orders = ORDERS.filter((o) => (!args.p_account || o.account_id === args.p_account) && groupOf(o.status_code) !== "cancelled");
  const r30 = orders.filter((o) => age(o) <= 30 * DAY);
  // catálogo por nombre: en los datos de prueba las líneas no traen el ID del producto
  const catalogOf = (acc: string, name: string) => CATALOG.find((c) => c.account_id === acc && c.name === name);
  const out: Row[] = [];

  for (const acc of ACCOUNTS.filter((a) => !args.p_account || a.id === args.p_account)) {
    const mine = r30.filter((o) => o.account_id === acc.id);
    const active30 = new Set(mine.filter((o) => o.dropshipper).map(storeId)).size;
    const active7 = new Set(mine.filter((o) => o.dropshipper && age(o) <= 7 * DAY).map(storeId)).size;
    const today = localDay(new Date().toISOString(), acc.timezone);
    const dayN = (iso: string) => Math.round((Date.parse(today) - Date.parse(localDay(iso, acc.timezone))) / DAY);
    const byProduct = new Map<string, { name: string; orders: Row[]; units: number }>();
    for (const o of mine) {
      for (const i of o.order_items ?? []) {
        const k = productKey(i);
        const g = byProduct.get(k) ?? { name: i.product_name, orders: [] as Row[], units: 0 };
        if (!g.orders.includes(o)) g.orders.push(o);
        g.units += i.quantity;
        byProduct.set(k, g);
      }
    }
    const firstOrder = (name: string) =>
      ORDERS.filter((o) => o.account_id === acc.id && (o.order_items ?? []).some((i: any) => i.product_name === name))
        .map((o) => o.ordered_at).sort()[0] ?? null;
    const base = (name: string) => {
      const c = catalogOf(acc.id, name);
      return {
        account_id: acc.id, account_name: acc.name, currency: acc.currency, name,
        product_id: c?.id ?? null, image_url: c?.image_url ?? null, status: c?.status ?? null, stock: c?.stock ?? null,
        created_at: c?.created_at_platform ?? null, first_order_at: firstOrder(name),
        active_stores30: active30, active_stores7: active7,
      };
    };
    for (const [k, g] of byProduct) {
      const os = g.orders;
      out.push({
        ...base(g.name), product_key: k,
        orders7: os.filter((o) => age(o) <= 7 * DAY).length,
        prev7: os.filter((o) => age(o) > 7 * DAY && age(o) <= 14 * DAY).length,
        orders30: os.length, units30: g.units,
        stores30: new Set(os.filter((o) => o.dropshipper).map(storeId)).size,
        stores7: new Set(os.filter((o) => o.dropshipper && age(o) <= 7 * DAY).map(storeId)).size,
        ticket: +(os.reduce((t, o) => t + o.total, 0) / os.length).toFixed(2),
        daily: Array.from({ length: 14 }, (_, i) => os.filter((o) => dayN(o.ordered_at) === 13 - i).length),
      });
    }
    // activos del catálogo sin pedidos en 30 días
    for (const c of CATALOG.filter((c) => c.account_id === acc.id && c.status === "Activo" && !byProduct.has(`name:${c.name}`))) {
      out.push({
        ...base(c.name), product_key: `name:${c.name}`, orders7: 0, prev7: 0, orders30: 0, units30: 0, stores30: 0, stores7: 0,
        ticket: null, daily: Array(14).fill(0),
      });
    }
  }
  return out.sort((a, b) => b.orders30 - a.orders30 || a.name.localeCompare(b.name));
}

export const fixtures: FixtureModule = { rpc: { product_performance: productPerformance } };
