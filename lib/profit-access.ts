import { cleanProfitProduct, type ProfitProduct, type ProfitInput } from "./profit.ts";

export type CostProduct = Omit<ProfitProduct, "markets"> & {
  markets: Omit<ProfitProduct["markets"][number], "price_community" | "price_users">[];
};
export type PriceProduct = Pick<ProfitProduct, "id" | "name"> & {
  markets: Pick<ProfitProduct["markets"][number], "account_id" | "price_community" | "price_users">[];
};

/** Explicit DTOs: restricted fields never cross the server/client boundary. */
export function costProduct(p: ProfitProduct): CostProduct {
  return {
    id: p.id, name: p.name, cost_currency: p.cost_currency, fx_gtq_per_usd: p.fx_gtq_per_usd,
    fx_hnl_per_usd: p.fx_hnl_per_usd ?? null,
    import_currency: p.import_currency ?? null, pickup_currency: p.pickup_currency ?? null,
    unit_cost: p.unit_cost, import_cost: p.import_cost, pickup_cost: p.pickup_cost, notes: p.notes,
    links: p.links.map(({ account_id, product_key }) => ({ account_id, product_key })),
    markets: p.markets.map(({ account_id, carrier, transfer_cost, qty_in, transfer_currency }) => ({ account_id, carrier, transfer_cost, qty_in, ...(transfer_currency ? { transfer_currency } : {}) })),
  };
}
export function priceProduct(p: ProfitProduct): PriceProduct {
  return { id: p.id, name: p.name, markets: p.markets.map(({ account_id, price_community, price_users }) => ({ account_id, price_community, price_users })) };
}

/** Only the cost fields are accepted, including when a forged form submits prices. */
export function cleanCostProduct(input: ProfitInput, accounts: { id: string; name: string }[]) {
  return cleanProfitProduct({ ...input, markets: Object.fromEntries(Object.entries(input.markets ?? {}).map(([id, m]) => [id, {
    carrier: m.carrier, transfer_cost: m.transfer_cost, transfer_currency: m.transfer_currency, qty_in: m.qty_in,
  }])) }, accounts);
}

/** Sparse upserts deliberately omit prices, preserving concurrent price edits. */
export function costMarketWrites(productId: string, markets: CostProduct["markets"], accountIds: string[]) {
  return accountIds.map((account_id) => {
    const m = markets.find((m) => m.account_id === account_id);
    return { product_id: productId, account_id, carrier: m?.carrier ?? null, transfer_cost: m?.transfer_cost ?? null, ...(m?.transfer_currency ? { transfer_currency: m.transfer_currency } : {}), qty_in: m?.qty_in ?? null };
  });
}
