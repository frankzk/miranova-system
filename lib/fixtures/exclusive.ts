// Simulación local de exclusive_idle (lo privatizado a cada tienda y su último pedido de ese
// producto): usa tiendas y productos reales de la simulación para ver todos los estados.
import type { FixtureCtx, FixtureModule, Row } from "./types";

type Plan = { units: number; days: number | null; since: number; held: number; n14: number; active: number; n7?: number };

// por tienda (de la que más vende a la que menos): qué tiene privatizado y cuándo lo pidió por última vez
const PLANS: Plan[][] = [
  [{ units: 36, days: 0, since: 40, held: 20, n14: 30, active: 7, n7: 14 }], // al día
  [{ units: 25, days: 2, since: 15, held: 13, n14: 21, active: 6 }], // dejó de pautar, lo vendía seguido
  [{ units: 288, days: 4, since: 161, held: 33, n14: 59, active: 2 }, { units: 157, days: 42, since: 30, held: 67, n14: 2, active: 1 }],
  [
    { units: 289, days: 13, since: 8, held: 20, n14: 8, active: 4 },
    { units: 236, days: 9, since: 14, held: 20, n14: 14, active: 5 },
    { units: 131, days: null, since: 0, held: 34, n14: 0, active: 0 },
    { units: 2, days: 6, since: 50, held: 20, n14: 40, active: 7 },
  ],
  [{ units: 60, days: null, since: 0, held: 1, n14: 0, active: 0 }], // recién privatizado
  [{ units: 3, days: 5, since: 20, held: 30, n14: 10, active: 3 }], // dejó de pautar, pero quedan 3 u.: no avisa
];

function exclusiveIdle(args: Row, { ORDERS, ACCOUNTS, CATALOG, DAY, groupOf, localDay }: FixtureCtx) {
  const out: Row[] = [];
  const now = Date.now();
  const iso = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();
  for (const acc of ACCOUNTS.slice(0, 2)) {
    if (args.p_account && acc.id !== args.p_account) continue;
    const today = localDay(new Date(now).toISOString(), acc.timezone);
    const dayOf = (daysAgo: number) => localDay(iso(daysAgo), acc.timezone);
    const ago = (at: string) => Math.round((Date.parse(today) - Date.parse(localDay(at, acc.timezone))) / DAY);
    const stores = new Map<string, { n: number; last: string }>();
    for (const o of ORDERS) {
      if (o.account_id !== acc.id || !o.dropshipper || groupOf(o.status_code) === "cancelled" || now - Date.parse(o.ordered_at) > 60 * DAY) continue;
      const s = stores.get(o.dropshipper) ?? { n: 0, last: o.ordered_at };
      s.n += 1;
      if (o.ordered_at > s.last) s.last = o.ordered_at;
      stores.set(o.dropshipper, s);
    }
    const products = CATALOG.filter((p) => p.account_id === acc.id);
    const top = [...stores].sort((a, b) => b[1].n - a[1].n).slice(0, PLANS.length);
    const list: [string, { n: number; last: string } | null, Plan[]][] = top.map(([name, s], i) => [name, s, PLANS[i]]);
    // una tienda que privatizó stock y todavía no tiene ningún pedido (no sale en Salud ni tiene ficha)
    if (acc === ACCOUNTS[0]) list.push(["Tienda Dormida", null, [{ units: 100, days: null, since: 0, held: 34, n14: 0, active: 0 }]]);
    list.forEach(([name, s, plans], si) => {
      // coherente con Salud: lo privatizado no puede tener pedidos más recientes que la tienda
      const storeDays = s ? ago(s.last) : null;
      plans.forEach((plan, pi) => {
        const p = { ...plan, days: plan.days === null ? null : Math.max(plan.days, storeDays ?? 0) };
        const prod = products[(si * 3 + pi) % Math.max(1, products.length)];
        out.push({
          account_id: acc.id, account_name: acc.name, today,
          store_id: `name:${name}`, store_name: name,
          product_external_id: prod?.external_id ?? `p${si}${pi}`, product_name: prod?.name ?? `Producto ${si}${pi}`, product_code: prod?.code ?? null,
          units: p.units,
          since: iso(p.held), held_days: p.held,
          last_at: p.days === null ? null : iso(p.days), last_day: p.days === null ? null : dayOf(p.days), days_since: p.days,
          orders_since: p.since, n7: p.n7 ?? 0, n14_before: p.n14, active_before: p.active,
          store_last_at: storeDays === null ? null : iso(storeDays), store_days_since: storeDays,
          movements_sync_at: iso(0.01),
        });
      });
    });
  }
  return out;
}

export const fixtures: FixtureModule = { rpc: { exclusive_idle: exclusiveIdle } };
