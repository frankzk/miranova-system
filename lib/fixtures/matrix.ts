// Simulación local de store_product_matrix (Tienda × producto, con el período anterior).
import type { FixtureCtx, FixtureModule, Row } from "./types";

function storeProductMatrix(args: Row, { ORDERS, ACCOUNTS, DAY, groupOf, storeId, productKey, localDay }: FixtureCtx) {
  const now = Date.now();
  const days = Math.min(90, Math.max(1, Number(args.p_days) || 30));
  const age = (o: Row) => now - Date.parse(o.ordered_at);
  const orders = ORDERS.filter((o) =>
    (!args.p_account || o.account_id === args.p_account) && o.dropshipper && groupOf(o.status_code) !== "cancelled" &&
    age(o) <= Math.max(90, 2 * days) * DAY);
  const inPeriod = (o: Row) => age(o) <= days * DAY;
  const inPrev = (o: Row) => age(o) > days * DAY && age(o) <= 2 * days * DAY;
  const in90 = (o: Row) => age(o) <= 90 * DAY;
  const tz = (id: string) => ACCOUNTS.find((a) => a.id === id)?.timezone ?? "America/Tegucigalpa";

  type S = Row & { _p: Set<string>; _pp: Set<string>; _d: Set<string> };
  const cells = new Map<string, Row>();
  const stores = new Map<string, S>();
  const products = new Map<string, Row & { _s90: Set<string>; _s: Set<string>; _sp: Set<string> }>();
  for (const o of orders) {
    const sid = storeId(o);
    const s = stores.get(`${o.account_id}|${sid}`) ?? {
      account_id: o.account_id, store_id: sid, name: o.dropshipper, orders: 0, orders_prev: 0, orders90: 0, skus: 0, skus_prev: 0,
      active_days: 0, units: 0, sales: 0, last_at: "", today: localDay(new Date().toISOString(), tz(o.account_id)),
      fu_at: null, fu_before: null, fu_after: null, _at: "", _p: new Set<string>(), _pp: new Set<string>(), _d: new Set<string>(),
    };
    if (in90(o)) s.orders90++;
    if (inPrev(o)) s.orders_prev++;
    if (inPeriod(o)) {
      s.orders++;
      s.units += (o.order_items ?? []).reduce((t: number, i: Row) => t + i.quantity, 0);
      s.sales = Math.round((s.sales + Number(o.total ?? 0)) * 100) / 100;
      s._d.add(localDay(o.ordered_at, tz(o.account_id)));
    }
    if (o.ordered_at > s._at) {
      s._at = o.ordered_at;
      s.last_at = localDay(o.ordered_at, tz(o.account_id));
      s.name = o.dropshipper;
    }
    stores.set(`${o.account_id}|${sid}`, s);
    for (const pk of new Set<string>((o.order_items ?? []).map(productKey))) {
      const c = cells.get(`${o.account_id}|${sid}|${pk}`) ?? { account_id: o.account_id, store_id: sid, product_key: pk, n: 0, p: 0, n90: 0, last_at: "" };
      if (in90(o)) c.n90++;
      if (inPeriod(o)) {
        c.n++;
        s._p.add(pk);
      }
      if (inPrev(o)) {
        c.p++;
        s._pp.add(pk);
      }
      const d = localDay(o.ordered_at, tz(o.account_id));
      if (d > c.last_at) c.last_at = d;
      cells.set(`${o.account_id}|${sid}|${pk}`, c);
      const p = products.get(`${o.account_id}|${pk}`) ?? {
        account_id: o.account_id, product_key: pk, name: pk.slice(5), // "name:<producto>"
        orders: 0, orders_prev: 0, orders90: 0, stores90: 0, stores: 0, stores_prev: 0, _s90: new Set<string>(), _s: new Set<string>(), _sp: new Set<string>(),
      };
      if (in90(o)) {
        p.orders90++;
        p._s90.add(sid);
      }
      if (inPeriod(o)) {
        p.orders++;
        p._s.add(sid);
      }
      if (inPrev(o)) {
        p.orders_prev++;
        p._sp.add(sid);
      }
      products.set(`${o.account_id}|${pk}`, p);
    }
  }
  // un contacto de ejemplo hace 10 días a la tienda con más pedidos: 7 días antes vs. 7 desde ese día
  const top = [...stores.values()].sort((a, b) => b.orders - a.orders)[0];
  if (top) {
    const at = new Date(now - 10 * DAY).toISOString();
    const day = localDay(at, tz(top.account_id));
    const mine = orders.filter((o) => o.account_id === top.account_id && storeId(o) === top.store_id).map((o) => localDay(o.ordered_at, tz(o.account_id)));
    const plus = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
    top.fu_at = day;
    top.fu_before = mine.filter((d) => d >= plus(day, -7) && d < day).length;
    top.fu_after = mine.filter((d) => d >= day && d < plus(day, 7)).length;
  }
  const byOrders = (a: Row, b: Row) => b.orders - a.orders || b.orders_prev - a.orders_prev;
  return {
    days,
    accounts: ACCOUNTS.filter((a) => [...stores.values()].some((s) => s.account_id === a.id))
      .map((a) => ({ account_id: a.id, account_name: a.name, currency: a.currency })),
    stores: [...stores.values()].map(({ _p, _pp, _d, _at, ...s }) => ({ ...s, skus: _p.size, skus_prev: _pp.size, active_days: _d.size })).sort(byOrders),
    products: [...products.values()].map(({ _s90, _s, _sp, ...p }) => ({ ...p, stores90: _s90.size, stores: _s.size, stores_prev: _sp.size })).sort(byOrders),
    cells: [...cells.values()],
  };
}

export const fixtures: FixtureModule = { rpc: { store_product_matrix: storeProductMatrix } };
