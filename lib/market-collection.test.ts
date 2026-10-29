import test from "node:test";
import assert from "node:assert/strict";
import { cleanCostProduct, costMarketWrites, costProduct, priceProduct } from "./profit-access.ts";
import { costIndex, marketEconomics, unitCosts, type ProfitProduct } from "./profit.ts";

const p: ProfitProduct = { id: "p", name: "Producto", cost_currency: "USD", fx_gtq_per_usd: 8, fx_hnl_per_usd: 25,
  unit_cost: 4, import_cost: 1, pickup_cost: 0.25, notes: null, links: [{ account_id: "hn", product_key: "item" }],
  markets: [{ account_id: "hn", carrier: "raulito", transfer_cost: 19, transfer_currency: "HNL", collection_cost: 3.5,
    collection_currency: "HNL", qty_in: 100, price_community: 250, price_users: 300 }] };
const close = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 0.000001);

test("separating 19 transfer and 3.50 collection preserves the original 22.50 total", () => {
  const c = unitCosts(p, p.markets[0]);
  close(c.collection, 3.5 / 25);
  close(c.transfer, 19 / 25);
  close(c.landed, unitCosts(p, { transfer_cost: 22.5, transfer_currency: "HNL" }).landed!);
  close(c.landed, 6.15);
  close(marketEconomics(p, p.markets[0], 0.04).investment, 615);
  close(marketEconomics(p, p.markets[0], 0.04).users!.profit, 12 - 6.15 - 1.2);
  close(costIndex([p]).get("hn|item")!.landed, 6.15);
});
test("collection currencies convert independently and missing positive-rate costs block totals", () => {
  const m = { ...p.markets[0], collection_cost: 4, collection_currency: "GTQ" as const };
  close(unitCosts(p, m).collection, 0.5);
  assert.equal(unitCosts({ ...p, fx_gtq_per_usd: null }, m).landed, null);
  assert.equal(unitCosts({ ...p, fx_gtq_per_usd: null }, { ...m, collection_cost: 0 }).collection, 0);
  assert.equal(unitCosts(p, { transfer_cost: 0 }).collection, 0);
  assert.equal(unitCosts(p).collection, 0);
});
test("collection round-trips in costs, stays hidden from prices and supports explicit clearing", () => {
  const input = { name: "Producto", unit_cost: "4", fx_hnl_per_usd: "25", markets: { hn: {
    transfer_cost: "19", transfer_currency: "HNL", collection_cost: "3.50", collection_currency: "HNL", price_users: "999" } } };
  const accounts = [{ id: "hn", name: "Honduras" }];
  const result = cleanCostProduct(input, accounts);
  assert.ok(result.ok);
  if (!result.ok) return;
  const [patch] = costMarketWrites("p", result.markets, ["hn"]);
  assert.equal(patch.collection_cost, 3.5);
  assert.equal(patch.collection_currency, "HNL");
  assert.equal("price_users" in patch, false);
  assert.equal(costProduct(p).markets[0].collection_cost, 3.5);
  assert.equal("collection_cost" in priceProduct(p).markets[0], false);
  const cleared = cleanCostProduct({ ...input, markets: { hn: { collection_cost: "", collection_currency: "HNL" } } }, accounts);
  assert.ok(cleared.ok);
  if (cleared.ok) assert.equal(costMarketWrites("p", cleared.markets, ["hn"])[0].collection_cost, null);
  assert.equal("collection_cost" in costMarketWrites("p", [], ["hn"])[0], false, "old forms must not erase a saved collection");
  for (const invalid of [{ collection_cost: "-3.5" }, { collection_cost: "texto" }, { collection_cost: "10000001" }, { collection_currency: "INVALID" }]) {
    assert.equal(cleanCostProduct({ ...input, markets: { hn: { ...input.markets.hn, ...invalid } } }, accounts).ok, false);
  }
  assert.equal(cleanCostProduct({ ...input, fx_hnl_per_usd: "", markets: { hn: { collection_cost: "3.5", collection_currency: "HNL" } } }, accounts).ok, false);
});
