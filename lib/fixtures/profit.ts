// Simulación local de Rentabilidad: fichas de costos de ejemplo y profit_delivered calculado con
// las órdenes sintéticas (entregadas, por día de entrega o del pedido).
import type { FixtureModule, Row } from "./types";

const HN = "11111111-1111-4111-8111-111111111111";
const GT = "22222222-2222-4222-8222-222222222222";
const OWNER = "a0000000-0000-4000-8000-000000000001";
const at = new Date(Date.now() - 20 * 86_400_000).toISOString();
const id = (n: number) => `e0000000-0000-4000-8000-00000000000${n}`;
const DLG = "PRODUCTO EXCLUSIVO DLG";
const BELT = "Cinturón sin Hebilla Pack de 5";
const NAD = "NAD Mens Complex Energía Rendimiento y Vitalidad Masculina 60 Cápsulas";

const profit_products: Row[] = [
  { id: id(1), name: "Drenaje linfático DLG", cost_currency: "USD", fx_gtq_per_usd: null, unit_cost: 3.1, import_cost: 0.4, pickup_cost: 0.25, notes: null, created_by: OWNER, created_at: at, updated_at: at },
  { id: id(2), name: BELT, cost_currency: "GTQ", fx_gtq_per_usd: 7.65, unit_cost: 14, import_cost: null, pickup_cost: 2, notes: "Lote de agosto", created_by: OWNER, created_at: at, updated_at: at },
  { id: id(3), name: "NAD Mens Complex", cost_currency: "USD", fx_gtq_per_usd: null, unit_cost: null, import_cost: null, pickup_cost: null, notes: null, created_by: OWNER, created_at: at, updated_at: at },
];

const profit_markets: Row[] = [
  { product_id: id(1), account_id: HN, carrier: "raulito", transfer_cost: 0.6, price_community: 300, price_users: 319, qty_in: 1200 },
  { product_id: id(1), account_id: GT, carrier: null, transfer_cost: null, price_community: 95, price_users: 98.89, qty_in: 400 },
  { product_id: id(2), account_id: HN, carrier: "castaneda", transfer_cost: 5, price_community: 199, price_users: 210, qty_in: 500 },
  { product_id: id(3), account_id: HN, carrier: "raulito", transfer_cost: 0.5, price_community: null, price_users: 360, qty_in: null },
];

const profit_links: Row[] = [
  { product_id: id(1), account_id: HN, product_key: `name:${DLG}`, created_at: at },
  { product_id: id(1), account_id: GT, product_key: `name:${DLG}`, created_at: at },
  { product_id: id(2), account_id: HN, product_key: `name:${BELT}`, created_at: at },
  { product_id: id(3), account_id: HN, product_key: `name:${NAD}`, created_at: at },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

export const fixtures: FixtureModule = {
  tables: { profit_products, profit_markets, profit_links },
  rpc: {
    profit_delivered: (args, ctx) => {
      const rows = new Map<string, Row>();
      const orders = new Map<string, Row>();
      const names: Record<string, string> = {};
      const now = Date.now();
      for (const o of ctx.ORDERS) {
        if (ctx.groupOf(o.status_code) !== "delivered") continue;
        const tz = ctx.ACCOUNTS.find((a) => a.id === o.account_id)?.timezone ?? "America/Tegucigalpa";
        const tl = o.raw?.orderInfo?.statusTimeline ?? [];
        const deliveredAt = tl.length ? new Date(Math.min(now, Date.parse(tl[tl.length - 1].occurredAt))).toISOString() : o.ordered_at;
        const d = ctx.localDay(args.p_basis === "ordered" ? o.ordered_at : deliveredAt, tz);
        if (d < args.p_from) continue;
        const items: Row[] = o.order_items ?? [];
        const total = items.reduce((t, i) => t + Number(i.vendor_price ?? 0), 0);
        const fee = Number(o.vendor_amount) - Number(o.vendor_net);
        for (const it of items) {
          const k = ctx.productKey(it);
          const p = round2(Number(it.vendor_price) / it.quantity);
          const key = [d, o.account_id, k, p].join("|");
          const share = total > 0 ? Number(it.vendor_price) / total : 1 / items.length;
          const r = rows.get(key) ?? { d, a: o.account_id, k, p, u: 0, v: 0, f: 0, x: null, n: 0 };
          r.u += it.quantity;
          r.v = round2(r.v + Number(it.vendor_price));
          r.f = round2(r.f + share * fee);
          r.n += 1;
          rows.set(key, r);
          names[`${o.account_id}:${k}`] = it.product_name;
        }
        const ok = `${d}|${o.account_id}`;
        const c = orders.get(ok) ?? { d, a: o.account_id, n: 0 };
        c.n += 1;
        orders.set(ok, c);
      }
      return { rows: [...rows.values()], orders: [...orders.values()], names };
    },
  },
};
