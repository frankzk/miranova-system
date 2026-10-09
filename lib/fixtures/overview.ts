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
    months: Array.from({ length: 12 }, (_, i) => 11 - i).map((k) => {
      const ref = new Date();
      const month = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - k, 1)).toISOString().slice(0, 7);
      const inMonth = (iso: string) => localDay(iso, "America/Tegucigalpa").slice(0, 7) === month;
      const rows = ok.filter((o) => inMonth(o.ordered_at));
      return { k, month, active: new Set(rows.map(key)).size, new: stores.filter((s) => inMonth(s.first_at)).length, orders: rows.length };
    }),
    lists,
  };
}

// order_growth: semanas (lunes a domingo) y meses en hora de Centroamérica (UTC−6, sin horario de verano)
function orderGrowth(args: Row, { ORDERS }: FixtureCtx) {
  const local = (iso: string) => new Date(Date.parse(iso) - 6 * 3_600_000);
  const now = local(new Date().toISOString());
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const monday = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
  const w0 = monday(now);
  const m0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const pm0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const ts = ORDERS.filter((o) => !args.p_account || o.account_id === args.p_account).map((o) => local(o.ordered_at));
  const wk = (t: Date) => Math.round((w0.getTime() - monday(t).getTime()) / (7 * 86_400_000));
  const mk = (t: Date) => (now.getUTCFullYear() - t.getUTCFullYear()) * 12 + now.getUTCMonth() - t.getUTCMonth();
  const ew = now.getTime() - w0.getTime();
  const em = now.getTime() - m0.getTime();
  return {
    now: now.toISOString().slice(0, 16),
    weeks: Array.from({ length: 12 }, (_, i) => 11 - i).map((k) => ({
      k, start: day(new Date(w0.getTime() - k * 7 * 86_400_000)), orders: ts.filter((t) => wk(t) === k).length,
    })),
    months: Array.from({ length: 12 }, (_, i) => 11 - i).map((k) => ({
      k, month: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1)).toISOString().slice(0, 7), orders: ts.filter((t) => mk(t) === k).length,
    })),
    week_prev_to_date: ts.filter((t) => t.getTime() >= w0.getTime() - 7 * 86_400_000 && t.getTime() < w0.getTime() - 7 * 86_400_000 + ew).length,
    month_prev_to_date: ts.filter((t) => t >= pm0 && t.getTime() < Math.min(pm0.getTime() + em, m0.getTime())).length,
  };
}

export const fixtures: FixtureModule = { rpc: { active_stores: businessOverview, order_growth: orderGrowth } };
