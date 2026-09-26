// Simulación local de store_product_matrix (Matriz tienda × producto).
import type { FixtureCtx, FixtureModule, Row } from "./types";

function storeProductMatrix(args: Row, { ORDERS, ACCOUNTS, DAY, groupOf, storeId, productKey }: FixtureCtx) {
  const now = Date.now();
  const days = Math.min(90, Math.max(1, Number(args.p_days) || 30));
  const orders = ORDERS.filter((o) =>
    (!args.p_account || o.account_id === args.p_account) && o.dropshipper && groupOf(o.status_code) !== "cancelled" &&
    now - Date.parse(o.ordered_at) <= 90 * DAY);
  const inPeriod = (o: Row) => now - Date.parse(o.ordered_at) <= days * DAY;

  const cells = new Map<string, Row>();
  const stores = new Map<string, Row & { _p: Set<string>; _last: string }>();
  const products = new Map<string, Row & { _s: Set<string> }>();
  for (const o of orders) {
    const sid = storeId(o);
    const s = stores.get(`${o.account_id}|${sid}`) ?? { account_id: o.account_id, store_id: sid, name: o.dropshipper, orders: 0, orders90: 0, skus: 0, _p: new Set<string>(), _last: "" };
    s.orders90++;
    if (inPeriod(o)) s.orders++;
    if (o.ordered_at > s._last) {
      s._last = o.ordered_at;
      s.name = o.dropshipper;
    }
    stores.set(`${o.account_id}|${sid}`, s);
    for (const pk of new Set<string>((o.order_items ?? []).map(productKey))) {
      const c = cells.get(`${o.account_id}|${sid}|${pk}`) ?? { account_id: o.account_id, store_id: sid, product_key: pk, n: 0, n90: 0 };
      c.n90++;
      if (inPeriod(o)) {
        c.n++;
        s._p.add(pk);
      }
      cells.set(`${o.account_id}|${sid}|${pk}`, c);
      const p = products.get(`${o.account_id}|${pk}`) ?? {
        account_id: o.account_id, product_key: pk, name: pk.slice(5), // "name:<producto>"
        orders: 0, orders90: 0, stores90: 0, _s: new Set<string>(),
      };
      p.orders90++;
      if (inPeriod(o)) p.orders++;
      p._s.add(sid);
      products.set(`${o.account_id}|${pk}`, p);
    }
  }
  const byOrders = (a: Row, b: Row) => b.orders - a.orders || b.orders90 - a.orders90;
  return {
    days,
    accounts: ACCOUNTS.filter((a) => [...stores.values()].some((s) => s.account_id === a.id))
      .map((a) => ({ account_id: a.id, account_name: a.name, currency: a.currency })),
    stores: [...stores.values()].map(({ _p, _last, ...s }) => ({ ...s, skus: _p.size })).sort(byOrders),
    products: [...products.values()].map(({ _s, ...p }) => ({ ...p, stores90: _s.size })).sort(byOrders),
    cells: [...cells.values()],
  };
}

export const fixtures: FixtureModule = { rpc: { store_product_matrix: storeProductMatrix } };
