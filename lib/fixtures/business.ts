// Simulación local de business_overview (vista Negocio).
import type { FixtureCtx, FixtureModule, Row } from "./types";

function businessOverview(args: Row, { ACCOUNTS, CATALOG }: FixtureCtx) {
  const [hn, gt] = ACCOUNTS;
  const acc = ACCOUNTS.filter((a) => !args.p_account || a.id === args.p_account);
  const inCountry = (c: string) => !args.p_country || args.p_country === c;
  const accountOf = (country: string) => (country === "HN" ? hn.name : gt.name);
  const countries = acc.map((a, i) => ({
    account_id: a.id, account: a.name, country: a.country, currency: a.currency,
    orders: i === 0 ? 412 : 96, prev_orders: i === 0 ? 318 : 131, received: i === 0 ? 430 : 101,
    cancelled: i === 0 ? 18 : 5, delivered: i === 0 ? 240 : 70, failed: i === 0 ? 52 : 9,
    net_usd: i === 0 ? 5120.4 : 980.1, prev_net_usd: i === 0 ? 4210.9 : 1302.5, stores: i === 0 ? 6 : 3,
  }));
  const store = (name: string, country: string, cur: number, prev: number, flow: string) => ({
    account_id: country === "HN" ? hn.id : gt.id, store_id: `name:${name}`, account: accountOf(country), country, name, cur, prev, flow,
  });
  const top = [
    store("Tienda Norte", "HN", 160, 120, "growing"), store("Casa Bella", "HN", 120, 110, "steady"), store("Mercado Fácil", "HN", 60, 20, "growing"),
    store("Vital Market", "GT", 58, 96, "falling"), store("Ofertas Ya", "HN", 40, 0, "new"), store("Todo Hogar", "HN", 32, 30, "steady"),
  ].filter((x) => inCountry(x.country));
  const losing = [store("Vital Market", "GT", 58, 96, "falling"), store("Compra Rápida", "HN", 0, 22, "lost")].filter((x) => inCountry(x.country));
  const product = (i: number, country: string, units: number, prev: number, delivered: number, failed: number) => ({
    account: accountOf(country), country, name: CATALOG[i].name, units, prev_units: prev, stores: 1 + (i % 4), delivered, failed, vendor_usd: units * 9.5,
  });
  const products = [
    product(0, "HN", 220, 150, 120, 30), product(1, "HN", 90, 110, 50, 9), product(1, "GT", 30, 12, 20, 2),
    product(3, "HN", 44, 16, 22, 8), product(5, "HN", 12, 30, 8, 3), product(4, "GT", 0, 25, 0, 0),
  ].filter((x) => inCountry(x.country));
  const carriers = [
    { name: "Forza", account: hn.name, country: "HN", orders: 320, delivered: 190, failed: 40, h_to_dispatch: 9.4, d_to_deliver: 1.9, d_to_deliver_p90: 6.5 },
    { name: "Cargo Expreso", account: hn.name, country: "HN", orders: 92, delivered: 50, failed: 12, h_to_dispatch: 3.1, d_to_deliver: 1.7, d_to_deliver_p90: 5.0 },
    { name: "Forza", account: gt.name, country: "GT", orders: 96, delivered: 70, failed: 9, h_to_dispatch: 12.0, d_to_deliver: 0.9, d_to_deliver_p90: 3.0 },
  ].filter((x) => inCountry(x.country));
  const departments = [
    { name: "Lempira", account: hn.name, country: "HN", closed: 37, failed: 12, rate: 0.676 },
    { name: "Santa Bárbara", account: hn.name, country: "HN", closed: 101, failed: 27, rate: 0.733 },
  ].filter((x) => inCountry(x.country));
  const total = top.reduce((t, x) => t + x.cur, 0);
  return {
    days: args.p_days, country: args.p_country, countries,
    stores: { active: top.length, new: 1, lost: 1, recovered: 0, growing: 2, falling: 1, total, top, losing },
    products, carriers, departments,
  };
}

export const fixtures: FixtureModule = { rpc: { business_overview: businessOverview } };
