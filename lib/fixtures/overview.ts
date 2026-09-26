// Simulación local de active_stores (Resumen Miranova en Inicio).
import type { FixtureCtx, FixtureModule, Row } from "./types";

function businessOverview(args: Row, { ORDERS, ACCOUNTS, DAY, groupOf, storeId, localDay }: FixtureCtx) {
  const now = Date.now();
  const all = ORDERS.filter((o) => (!args.p_account || o.account_id === args.p_account) && o.dropshipper);
  const ok = all.filter((o) => groupOf(o.status_code) !== "cancelled");
  const age = (o: Row) => now - Date.parse(o.ordered_at);
  const tz = (o: Row) => ACCOUNTS.find((a) => a.id === o.account_id)?.timezone ?? "America/Tegucigalpa";
  const key = (o: Row) => `${o.account_id}|${storeId(o)}`;
  const by = new Map<string, Row[]>();
  for (const o of ok) by.set(key(o), [...(by.get(key(o)) ?? []), o]);
  const stores = [...by.values()].map((rows) => {
    const sorted = [...rows].sort((a, b) => a.ordered_at.localeCompare(b.ordered_at));
    const today = localDay(new Date().toISOString(), tz(rows[0]));
    const yesterday = localDay(new Date(now - DAY).toISOString(), tz(rows[0]));
    const gapBack = sorted.some((o, i) => i > 0 && age(o) <= 30 * DAY && Date.parse(o.ordered_at) - Date.parse(sorted[i - 1].ordered_at) >= 30 * DAY);
    return {
      account_id: rows[0].account_id, store_id: storeId(rows[0]), name: sorted.at(-1)!.dropshipper,
      account_name: ACCOUNTS.find((a) => a.id === rows[0].account_id)?.name,
      first_at: sorted[0].ordered_at, last_at: sorted.at(-1)!.ordered_at,
      firstMonth: localDay(sorted[0].ordered_at, tz(rows[0])).slice(0, 7) === today.slice(0, 7),
      n30: rows.filter((o) => age(o) <= 30 * DAY).length,
      n7: rows.filter((o) => age(o) <= 7 * DAY).length,
      n2d: rows.filter((o) => [today, yesterday].includes(localDay(o.ordered_at, tz(o)))).length,
      n14: rows.filter((o) => age(o) <= 14 * DAY).length,
      nBefore: rows.filter((o) => age(o) > 14 * DAY && age(o) <= 44 * DAY).length,
      gapBack,
    };
  });
  const r30 = ok.filter((o) => age(o) <= 30 * DAY);
  const tickets = [...new Set(r30.map((o) => o.currency))].map((currency) => {
    const xs = r30.filter((o) => o.currency === currency);
    return { currency, ticket: +(xs.reduce((t, o) => t + o.total, 0) / xs.length).toFixed(2), orders: xs.length };
  });
  const units = r30.map((o) => (o.order_items ?? []).reduce((t: number, i: Row) => t + i.quantity, 0));
  const lists = [
    ...stores.filter((s) => s.firstMonth).map((s) => ({ kind: "new", ...s, orders: s.n30, at: s.first_at })),
    ...stores.filter((s) => s.gapBack).map((s) => ({ kind: "reactivated", ...s, orders: s.n30, at: s.last_at })),
    ...stores.filter((s) => s.n14 === 0 && s.nBefore >= 3).map((s) => ({ kind: "stopped", ...s, orders: s.nBefore, at: s.last_at })),
  ].map(({ kind, account_id, store_id, account_name, name, orders, at }) => ({ kind, account_id, store_id, account_name, name, orders, at }));
  const inWeek = (o: Row, k: number) => age(o) >= k * 7 * DAY && age(o) < (k + 1) * 7 * DAY;
  return {
    orders_today: ok.filter((o) => localDay(o.ordered_at, tz(o)) === localDay(new Date().toISOString(), tz(o))).length,
    orders_7d: ok.filter((o) => age(o) <= 7 * DAY).length,
    orders_prev7: ok.filter((o) => age(o) > 7 * DAY && age(o) <= 14 * DAY).length,
    orders_30d: r30.length,
    units_per_order: units.length ? +(units.reduce((t, u) => t + u, 0) / units.length).toFixed(2) : null,
    tickets,
    stores: {
      registered: new Set(all.map(key)).size,
      active30: stores.filter((s) => s.n30 > 0).length,
      active7: stores.filter((s) => s.n7 > 0).length,
      active2d: stores.filter((s) => s.n2d > 0).length,
      new_month: lists.filter((l) => l.kind === "new").length,
      reactivated: lists.filter((l) => l.kind === "reactivated").length,
      stopped: lists.filter((l) => l.kind === "stopped").length,
    },
    weeks: Array.from({ length: 12 }, (_, i) => 11 - i).map((k) => ({
      k,
      active: new Set(ok.filter((o) => inWeek(o, k)).map(key)).size,
      new: stores.filter((s) => { const a = now - Date.parse(s.first_at); return a >= k * 7 * DAY && a < (k + 1) * 7 * DAY; }).length,
      orders: ok.filter((o) => inWeek(o, k)).length,
    })),
    lists,
  };
}

export const fixtures: FixtureModule = { rpc: { active_stores: businessOverview } };
