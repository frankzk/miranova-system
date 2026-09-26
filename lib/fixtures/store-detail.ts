// Simulación local de store_detail (ficha 360° de una tienda), con las mismas reglas que la función SQL.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FixtureCtx, FixtureModule, Row } from "./types";

const avg = (xs: number[]) => (xs.length ? +(xs.reduce((t, x) => t + x, 0) / xs.length).toFixed(2) : null);
const units = (o: Row) => (o.order_items ?? []).reduce((t: number, i: any) => t + i.quantity, 0);

function storeDetail(args: Row, { ORDERS, ACCOUNTS, DAY, groupOf, storeId, productKey, localDay }: FixtureCtx) {
  const acc = ACCOUNTS.find((a) => a.id === args.p_account);
  if (!acc) return null;
  const tz = acc.timezone;
  const now = Date.now();
  const today = localDay(new Date().toISOString(), tz);
  const shift = (n: number) => new Date(Date.parse(today) + n * DAY).toISOString().slice(0, 10);
  const age = (o: Row) => now - Date.parse(o.ordered_at);
  const ok = (o: Row) => groupOf(o.status_code) !== "cancelled";

  const all = ORDERS.filter((o) => o.account_id === acc.id && o.dropshipper && storeId(o) === args.p_store_id);
  if (!all.length) return null;
  const rows = all.filter(ok);
  const r30 = rows.filter((o) => age(o) <= 30 * DAY);
  const dayOf = (o: Row) => localDay(o.ordered_at, tz);
  const by = new Map<string, Row[]>();
  for (const o of rows) by.set(dayOf(o), [...(by.get(dayOf(o)) ?? []), o]);
  const sum = (a: Row[], k: string) => +a.reduce((t, o) => t + Number(o[k] ?? 0), 0).toFixed(2);
  const lastDay = rows.map(dayOf).sort().pop();

  const pm = new Map<string, Row>();
  for (const o of r30) for (const it of o.order_items ?? []) {
    const k = productKey(it);
    const cur: Row = pm.get(k) ?? { product_key: k, name: it.product_name, orders: new Set(), units: 0, sales: 0 };
    cur.orders.add(o.id);
    cur.units += it.quantity;
    cur.sales += it.price;
    pm.set(k, cur);
  }

  const peers = new Map<string, Row[]>();
  for (const o of ORDERS) {
    if (o.account_id !== acc.id || !o.dropshipper || !ok(o) || age(o) > 30 * DAY) continue;
    peers.set(storeId(o), [...(peers.get(storeId(o)) ?? []), o]);
  }
  const peerStats = [...peers].map(([id, a]) => ({
    id, d7: a.filter((o) => age(o) <= 7 * DAY).length, ticket: avg(a.map((o) => o.total))!, upo: avg(a.map(units))!,
  }));
  const mine = peerStats.find((p) => p.id === args.p_store_id)?.d7 ?? 0;
  const best = (days: [string, Row[]][]) => {
    const top = days.sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? 1 : -1))[0];
    return top ? { day: top[0], orders: top[1].length } : null;
  };

  return {
    store: {
      account_id: acc.id, account_name: acc.name, platform: acc.platform, country: acc.country, currency: acc.currency, timezone: tz,
      store_id: args.p_store_id, name: [...all].sort((a, b) => (a.ordered_at < b.ordered_at ? 1 : -1))[0].dropshipper, today,
    },
    kpis: {
      today: by.get(today)?.length ?? 0,
      d7: rows.filter((o) => age(o) <= 7 * DAY).length,
      prev7: rows.filter((o) => age(o) > 7 * DAY && age(o) <= 14 * DAY).length,
      n30: r30.length, sales30: sum(r30, "total"), vendor30: sum(r30, "vendor_amount"),
      ticket: avg(r30.map((o) => o.total)), vendor_per_order: avg(r30.map((o) => o.vendor_amount)), units_per_order: avg(r30.map(units)),
      delivered30: r30.filter((o) => groupOf(o.status_code) === "delivered").length,
      failed30: r30.filter((o) => groupOf(o.status_code) === "failed").length,
      active7: [...by.keys()].filter((d) => d > shift(-7)).length,
      active_prev7: [...by.keys()].filter((d) => d > shift(-14) && d <= shift(-7)).length,
      last_at: rows.map((o) => o.ordered_at).sort().pop() ?? null,
      days_since: lastDay ? Math.round((Date.parse(today) - Date.parse(lastDay)) / DAY) : null,
      first_at: rows.map((o) => o.ordered_at).sort()[0] ?? null,
    },
    daily: Array.from({ length: 90 }, (_, i) => {
      const day = shift(i - 89);
      const a = by.get(day) ?? [];
      return { day, orders: a.length, sales: sum(a, "total"), units: a.reduce((t, o) => t + units(o), 0) };
    }),
    products: [...pm.values()]
      .map((p): Row => ({ ...p, orders: p.orders.size, sales: +p.sales.toFixed(2), share: r30.length ? +(p.orders.size / r30.length).toFixed(4) : null }))
      .sort((a, b) => b.orders - a.orders || b.units - a.units),
    activity: {
      best30: best([...by].filter(([d]) => d > shift(-30))),
      record: best([...by]),
    },
    benchmark: peerStats.length ? {
      stores: peerStats.length,
      orders_per_day: +(peerStats.reduce((t, p) => t + p.d7, 0) / peerStats.length / 7).toFixed(2),
      ticket: avg(peerStats.map((p) => p.ticket)),
      units_per_order: avg(peerStats.map((p) => p.upo)),
      rank_d7: peerStats.filter((p) => p.d7 > mine).length + 1,
    } : null,
  };
}

export const fixtures: FixtureModule = { rpc: { store_detail: storeDetail } };
