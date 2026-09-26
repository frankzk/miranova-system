import assert from "node:assert/strict";
import { test } from "node:test";
import { daysLeft, inventoryAlerts, reorderList, returnRate, stockLevel, toCover, type InventoryRow } from "./inventory.ts";

const row = (p: Partial<InventoryRow>): InventoryRow => ({
  account_id: "a", account_name: "Drop Honduras", external_id: "p", code: null, name: "Producto", status: "Activo", image_url: null,
  stock: 0, variants_count: 0, out14: 0, ret14: 0, out30: 0, ret30: 0, last_out_at: null, first_at: null, last_restock_at: null,
  restocks: [], pending_orders: 0, daily: [], ...p,
});

test("días que alcanza con salida neta (salidas − devoluciones)", () => {
  // Cayenne HN: 55 u., 417 salidas y 97 devoluciones en 14 días → 22.9/día → 2.4 días
  const r = row({ stock: 55, out14: 417, ret14: 97 });
  assert.equal(Math.round(daysLeft(r)! * 10) / 10, 2.4);
  assert.equal(stockLevel(r), "critical");
  assert.equal(stockLevel(row({ stock: 50, out14: 140 })), "low"); // 10/día → 5 días
});

test("niveles: agotado con demanda, sin movimiento, suficiente", () => {
  assert.equal(stockLevel(row({ stock: 0, out14: 145 })), "out");
  assert.equal(stockLevel(row({ stock: 0, pending_orders: 3 })), "out");
  assert.equal(stockLevel(row({ stock: 0 })), "idle");
  assert.equal(stockLevel(row({ stock: 80, out14: 0 })), "idle");
  assert.equal(stockLevel(row({ stock: 300, out14: 140 })), "ok");
  assert.equal(toCover(row({ stock: 0, out14: 140 }), 14), 140);
});

test("qué reponer primero y alertas", () => {
  const a = row({ external_id: "a", name: "Agotado", stock: 0, out14: 145, pending_orders: 4 });
  const b = row({ external_id: "b", name: "Dos días", stock: 55, out14: 417, ret14: 97 });
  const c = row({ external_id: "c", name: "Holgado", stock: 500, out14: 70 });
  assert.deepEqual(reorderList([c, b, a]).map((r) => r.name), ["Agotado", "Dos días"]);
  assert.equal(returnRate(row({ out30: 10, ret30: 5 })), null); // poca muestra
  const alerts = inventoryAlerts([c, b, a, row({ external_id: "d", name: "Devuelve", stock: 500, out14: 70, out30: 200, ret30: 60 })]);
  assert.deepEqual(alerts.map((x) => [x.product_name, x.kind]), [["Agotado", "stockout"], ["Dos días", "low_stock"], ["Devuelve", "returns"]]);
});
