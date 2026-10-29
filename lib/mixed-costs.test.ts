import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanProfitProduct, unitCosts, marketEconomics, automaticCostFx, costIndex, type ProfitProduct } from "./profit.ts";
import { cleanCostProduct, costProduct, costMarketWrites, priceProduct } from "./profit-access.ts";

const p: ProfitProduct = { id: "p", name: "Producto", cost_currency: "USD", import_currency: "USD", pickup_currency: "GTQ",
  fx_gtq_per_usd: 8, fx_hnl_per_usd: 25, unit_cost: 4, import_cost: 1, pickup_cost: 4, notes: null,
  markets: [{ account_id: "hn", carrier: null, transfer_cost: 25, transfer_currency: "HNL", price_community: 250, price_users: 300, qty_in: 100 }],
  links: [{ account_id: "hn", product_key: "product" }],
};
test("mixed currencies: converts each amount separately, including actual profitability and investment", () => {
  const m = p.markets[0];
  assert.deepEqual(unitCosts(p, m), { cost_total: 5, pickup: 0.5, transfer: 1, landed: 6.5 });
  const e = marketEconomics(p, m, 0.04);
  assert.equal(e.investment, 650);
  assert.ok(Math.abs(e.users!.profit - 4.3) < 0.00001);
  assert.equal(costIndex([p]).get("hn|product")?.landed, 6.5);
  assert.equal(unitCosts({ ...p, import_currency: "GTQ", import_cost: 8 }, m).landed, 6.5);
});
test("missing quote on any positive cost makes profitability unavailable instead of silently treating it as zero", () => {
  assert.equal(unitCosts({ ...p, fx_gtq_per_usd: null }, p.markets[0]).landed, null);
  assert.equal(unitCosts({ ...p, fx_hnl_per_usd: null }, p.markets[0]).landed, null);
  assert.equal(unitCosts({ ...p, pickup_cost: 0, fx_gtq_per_usd: null }, p.markets[0]).landed, 6);
  assert.equal(automaticCostFx([{ id: "gt", currency: "GTQ", usd_rate: 0.125 }], "GTQ"), 8);
});
test("legacy amounts retain the original single currency when currency columns are absent", () => {
  const legacy = { ...p, cost_currency: "GTQ" as const, import_currency: null, pickup_currency: null };
  assert.equal(unitCosts(legacy, { transfer_cost: 8 }).landed, (4 + 1 + 4 + 8) / 8);
});
test("validation and sparse writes retain currency choices without writing commercial prices", () => {
  const input = { name: "Producto", cost_currency: "USD", import_currency: "USD", pickup_currency: "GTQ", fx_gtq_per_usd: "8", fx_hnl_per_usd: "25",
    unit_cost: "4", import_cost: "1", pickup_cost: "4", markets: { hn: { transfer_cost: "25", transfer_currency: "HNL", price_users: "999" } } };
  const accounts = [{ id: "hn", name: "Honduras" }];
  const c = cleanCostProduct(input, accounts);
  assert.ok(c.ok);
  if (c.ok) {
    assert.equal(c.row.pickup_currency, "GTQ");
    const [patch] = costMarketWrites("p", c.markets, ["hn"]);
    assert.equal(patch.transfer_currency, "HNL");
    assert.equal("price_users" in patch, false);
  }
  assert.equal(cleanProfitProduct({ ...input, pickup_currency: "INVALID" }, accounts).ok, false);
  assert.equal(cleanProfitProduct({ ...input, markets: { hn: { transfer_currency: "INVALID", transfer_cost: "25" } } }, accounts).ok, false);
  assert.equal(cleanProfitProduct({ ...input, fx_hnl_per_usd: "" }, accounts).ok, false);
  assert.equal(costProduct(p).markets[0].transfer_currency, "HNL");
  assert.equal("pickup_currency" in priceProduct(p), false);
});
