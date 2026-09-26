// Simulación local de store_health (Salud de tiendas).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FixtureCtx, FixtureModule, Row } from "./types";

function storeHealth(args: Row, { ORDERS, ACCOUNTS, DAY, groupOf }: FixtureCtx) {
  const now = Date.now();
  const dayOf = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
  const groups = new Map<string, Row[]>();
  for (const o of ORDERS) {
    if (args.p_account && o.account_id !== args.p_account) continue;
    if (!o.dropshipper || groupOf(o.status_code) === "cancelled" || now - Date.parse(o.ordered_at) > 60 * DAY) continue;
    const k = `${o.account_id}|${o.dropshipper}`;
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  const out = [...groups.values()].map((rows) => {
    const acc = ACCOUNTS.find((a) => a.id === rows[0].account_id)!;
    const tz = acc.timezone;
    const today = dayOf(new Date().toISOString(), tz);
    const dayN = (iso: string) => Math.round((Date.parse(today) - Date.parse(dayOf(iso, tz))) / DAY); // 0 = hoy
    const age = (o: Row) => now - Date.parse(o.ordered_at);
    const r30 = rows.filter((o) => age(o) <= 30 * DAY);
    const avg = (xs: number[]) => (xs.length ? +(xs.reduce((t, x) => t + x, 0) / xs.length).toFixed(2) : null);
    const daily = Array.from({ length: 14 }, (_, i) => rows.filter((o) => dayN(o.ordered_at) === 13 - i).length);
    const since = Math.min(...rows.map((o) => dayN(o.ordered_at)));
    return {
      account_id: acc.id, store_id: `name:${rows[0].dropshipper}`, account_name: acc.name, currency: acc.currency, name: rows[0].dropshipper,
      today: rows.filter((o) => dayN(o.ordered_at) === 0).length,
      d7: rows.filter((o) => age(o) <= 7 * DAY).length,
      prev7: rows.filter((o) => age(o) > 7 * DAY && age(o) <= 14 * DAY).length,
      active7: new Set(rows.filter((o) => dayN(o.ordered_at) < 7).map((o) => dayN(o.ordered_at))).size,
      active_prev7: new Set(rows.filter((o) => dayN(o.ordered_at) >= 7 && dayN(o.ordered_at) < 14).map((o) => dayN(o.ordered_at))).size,
      last_at: rows.map((o) => o.ordered_at).sort().pop(), days_since: since,
      n30: r30.length, ticket: avg(r30.map((o) => o.total)), vendor_per_order: avg(r30.map((o) => o.vendor_amount)),
      units_per_order: avg(r30.map((o) => (o.order_items ?? []).reduce((t: number, i: any) => t + i.quantity, 0))),
      delivered30: r30.filter((o) => groupOf(o.status_code) === "delivered").length,
      failed30: r30.filter((o) => groupOf(o.status_code) === "failed").length,
    sales30: +r30.reduce((t, o) => t + o.total, 0).toFixed(2),
    ...topProduct(r30),
      daily,
    };
  });
  return out.sort((a, b) => b.d7 - a.d7);
}

/** Productos distintos en 30 días y el que más pedidos trae (como store_health). */
function topProduct(rows: Row[]) {
  const n = new Map<string, number>();
  for (const o of rows) for (const p of new Set<string>((o.order_items ?? []).map((i: any) => i.product_name))) n.set(p, (n.get(p) ?? 0) + 1);
  const [top, c] = [...n].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return { skus30: n.size, top_product: top, top_share: rows.length ? +(c / rows.length).toFixed(3) : null };
}

export const fixtures: FixtureModule = { rpc: { store_health: storeHealth } };
