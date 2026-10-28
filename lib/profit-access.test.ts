import test from "node:test";
import assert from "node:assert/strict";
import { can, normalizePermissions, ungrantable } from "./permissions.ts";
import { costProduct, priceProduct, cleanCostProduct, costMarketWrites } from "./profit-access.ts";
import type { ProfitProduct } from "./profit.ts";

const product: ProfitProduct = { id: "p", name: "Producto", cost_currency: "USD", fx_gtq_per_usd: null,
  unit_cost: 3, import_cost: 1, pickup_cost: 0.5, notes: "Compra", links: [{ account_id: "a", product_key: "1" }],
  markets: [{ account_id: "a", carrier: "otro", transfer_cost: 2, qty_in: 25, price_community: 120, price_users: 150 }],
};
test("costs, prices and profitability are independent permissions, including grant authority", () => {
  for (const permission of ["product_costs", "product_prices", "profit"] as const) {
    const user = { is_owner: false, permissions: [permission] };
    assert.deepEqual(normalizePermissions([permission]), [permission]);
    for (const other of ["product_costs", "product_prices", "profit"] as const) {
      assert.equal(can(user, other), permission === other);
      assert.deepEqual(ungrantable(user, [other]), permission === other ? [] : [other]);
      assert.equal(can({ is_owner: true, permissions: [] }, other), true);
    }
  }
});
test("cost DTO contains no commercial prices; price DTO contains no costs, inventory or notes", () => {
  const cost = costProduct(product);
  assert.equal(cost.unit_cost, 3);
  assert.deepEqual(cost.markets[0], { account_id: "a", carrier: "otro", transfer_cost: 2, qty_in: 25 });
  assert.deepEqual(priceProduct(product), { id: "p", name: "Producto", markets: [{ account_id: "a", price_community: 120, price_users: 150 }] });
});
test("forged prices are ignored by cost validation and excluded from persistence", () => {
  const result = cleanCostProduct({ name: "Producto", unit_cost: "4", markets: {
    a: { transfer_cost: "2.50", price_community: "999", price_users: "999" },
  } }, [{ id: "a", name: "Cuenta" }]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const [patch] = costMarketWrites("p", result.markets, ["a"]);
  assert.equal("price_community" in patch, false);
  assert.equal("price_users" in patch, false);
  const updated = { ...product.markets[0], ...patch };
  assert.equal(updated.price_community, 120);
  assert.equal(updated.price_users, 150);
  assert.equal(updated.transfer_cost, 2.5);
});
test("clearing cost fields preserves commercial prices rather than deleting the market", () => {
  const [patch] = costMarketWrites("p", [], ["a"]);
  assert.deepEqual({ ...product.markets[0], ...patch }, {
    product_id: "p", account_id: "a", carrier: null, transfer_cost: null, qty_in: null, price_community: 120, price_users: 150,
  });
});
