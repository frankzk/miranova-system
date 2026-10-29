import "server-only";
import { cache } from "react";
import { listAccounts } from "./accounts";
import { automaticCostFx, isCarrier, isCostCurrency, type CatalogItem, type Delivered, type DeliveredRow, type MarketAccount, type ProfitProduct } from "./profit";
import { listProducts } from "./queries";
import { db } from "./supabase";
import { synced } from "./synced-cache";

// tabla o función que todavía no existe (migración 0048 sin aplicar): la sección se ve vacía en vez de fallar
const missing = (e: { code?: string }) => ["42P01", "PGRST205", "PGRST202", "42883"].includes(e.code ?? "");

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

type ProductRow = Omit<ProfitProduct, "markets" | "links">;
type MarketRow = { product_id: string; account_id: string; carrier: string | null; transfer_cost: unknown; transfer_currency?: string | null; collection_cost?: unknown; collection_currency?: string | null; price_community: unknown; price_users: unknown; qty_in: unknown };
type LinkRow = { product_id: string; account_id: string; product_key: string };

/** Todas las fichas de costos, por nombre, con sus cuentas y los productos de la plataforma vinculados. */
export async function listProfitProducts(): Promise<ProfitProduct[]> {
  const [p, m, l, accounts] = await Promise.all([
    db().from("profit_products").select("id, name, cost_currency, import_currency, pickup_currency, fx_gtq_per_usd, fx_hnl_per_usd, unit_cost, import_cost, pickup_cost, notes").order("name").limit(5000),
    db().from("profit_markets").select("product_id, account_id, carrier, transfer_cost, transfer_currency, collection_cost, collection_currency, price_community, price_users, qty_in").limit(50000),
    db().from("profit_links").select("product_id, account_id, product_key").limit(50000),
    marketAccounts(),
  ]);
  if (p.error) {
    if (missing(p.error)) return [];
    throw p.error;
  }
  if (m.error) throw m.error;
  if (l.error) throw l.error;
  const markets = new Map<string, ProfitProduct["markets"]>();
  for (const r of (m.data ?? []) as MarketRow[]) {
    markets.set(r.product_id, [...(markets.get(r.product_id) ?? []), {
      account_id: r.account_id,
      carrier: isCarrier(r.carrier) ? r.carrier : null,
      transfer_cost: num(r.transfer_cost),
      transfer_currency: isCostCurrency(r.transfer_currency) ? r.transfer_currency : null,
      collection_cost: num(r.collection_cost),
      collection_currency: isCostCurrency(r.collection_currency) ? r.collection_currency : null,
      price_community: num(r.price_community),
      price_users: num(r.price_users),
      qty_in: num(r.qty_in),
    }]);
  }
  const links = new Map<string, ProfitProduct["links"]>();
  for (const r of (l.data ?? []) as LinkRow[]) links.set(r.product_id, [...(links.get(r.product_id) ?? []), { account_id: r.account_id, product_key: r.product_key }]);
  const hnlFx = automaticCostFx(accounts, "HNL"), gtqFx = automaticCostFx(accounts, "GTQ");
  return ((p.data ?? []) as ProductRow[]).map((r) => ({
    ...r,
    cost_currency: isCostCurrency(r.cost_currency) ? r.cost_currency : "USD",
    fx_gtq_per_usd: gtqFx,
    fx_hnl_per_usd: hnlFx,
    unit_cost: num(r.unit_cost),
    import_cost: num(r.import_cost),
    pickup_cost: num(r.pickup_cost),
    markets: markets.get(r.id) ?? [],
    links: links.get(r.id) ?? [],
  }));
}

const EMPTY: Delivered = { rows: [], orders: [], names: {} };

async function deliveredQuery(from: string, basis: "delivered" | "ordered"): Promise<Delivered> {
  const { data, error } = await db().rpc("profit_delivered", { p_from: from, p_basis: basis });
  if (error) {
    if (missing(error)) return EMPTY;
    throw error;
  }
  const d = (data ?? EMPTY) as Delivered;
  return {
    rows: (d.rows ?? []).map((r: DeliveredRow) => ({
      d: r.d, a: r.a, k: r.k, p: Number(r.p), u: Number(r.u), v: Number(r.v), f: num(r.f), x: num(r.x), n: Number(r.n),
    })),
    orders: (d.orders ?? []).map((o) => ({ d: o.d, a: o.a, n: Number(o.n) })),
    names: d.names ?? {},
  };
}

/** Lo entregado desde `from` (YYYY-MM-DD), por día × cuenta × producto × precio. Solo lee datos sincronizados. */
export const profitDelivered = synced("profit_delivered", deliveredQuery);

/**
 * Cuentas de venta (no las de solo catálogo) con su tipo de cambio de la plataforma; si una cuenta
 * todavía no lo tiene (sin productos sincronizados), el de otra con la misma moneda.
 */
export const marketAccounts = cache(async (): Promise<MarketAccount[]> => {
  const [accounts, fx] = await Promise.all([listAccounts(), db().from("account_fx").select("account_id, usd_rate")]);
  const rate = new Map(((fx.data ?? []) as { account_id: string; usd_rate: unknown }[]).map((r) => [r.account_id, num(r.usd_rate)]));
  const sale = accounts.filter((a) => !a.catalog_only);
  const byCurrency = new Map<string, number>();
  for (const a of sale) {
    const r = rate.get(a.id);
    if (r && !byCurrency.has(a.currency)) byCurrency.set(a.currency, r);
  }
  return sale.map((a) => ({
    id: a.id,
    name: a.name,
    country: a.country,
    currency: a.currency,
    usd_rate: rate.get(a.id) || byCurrency.get(a.currency) || (a.currency === "USD" ? 1 : null),
  }));
});

/**
 * Productos de cada cuenta para vincular a una ficha: el catálogo sincronizado y, además, los que
 * aparecen en lo entregado (por si ya no están en el catálogo). La clave es la de line_facts.
 */
export async function profitCatalog(delivered: Delivered): Promise<CatalogItem[]> {
  const products = await listProducts().catch((e) => (console.error("rentabilidad: productos", e), []));
  const out = new Map<string, CatalogItem>();
  for (const p of products) out.set(`${p.account_id}|${p.external_id}`, { account_id: p.account_id, product_key: p.external_id, name: p.name });
  for (const [k, name] of Object.entries(delivered.names)) {
    const i = k.indexOf(":");
    const key = `${k.slice(0, i)}|${k.slice(i + 1)}`;
    if (!out.has(key)) out.set(key, { account_id: k.slice(0, i), product_key: k.slice(i + 1), name });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** Dólares por unidad de la moneda de cada cuenta. */
export const ratesOf = (accounts: MarketAccount[]) => new Map(accounts.map((a) => [a.id, a.usd_rate]));
