import assert from "node:assert/strict";
import { test } from "node:test";
import { sortOpportunities, storeOpportunities } from "./opportunities.ts";
import type { StoreRow } from "./stores.ts";

const row = (p: Partial<StoreRow>): StoreRow => ({
  account_id: "a", store_id: "s", account_name: "Drop Honduras", currency: "HNL", name: "Tienda", today: 0, d7: 0, prev7: 0,
  active7: 0, active_prev7: 0, last_at: null, days_since: 0, n30: 0, ticket: null, vendor_per_order: null,
  units_per_order: null, delivered30: 0, failed30: 0, sales30: null, skus30: 0, top_product: null, top_share: null,
  daily: [], ...p,
});

test("las tiendas que se frenaron van primero, y entre ellas la que más pedidos perdió", () => {
  const items = sortOpportunities(storeOpportunities(
    [
      row({ name: "Crece", store_id: "c", d7: 90, prev7: 50, active7: 7, active_prev7: 7 }),
      row({ name: "Cae poco", store_id: "p", d7: 12, prev7: 20, active7: 5, active_prev7: 5, days_since: 0 }),
      row({ name: "Se frenó", store_id: "f", d7: 40, prev7: 100, active7: 4, active_prev7: 7, days_since: 3 }),
    ],
    {},
    () => String,
  ));
  assert.deepEqual(items.map((i) => [i.subject.name, i.kind, i.group]), [
    ["Se frenó", "silent", "contact"],
    ["Cae poco", "volume", "contact"],
    ["Crece", "growth", "grow"],
  ]);
  assert.equal(items[0].meta, "40 pedidos en 7 días (antes 100) · 4/7 días activos");
});
