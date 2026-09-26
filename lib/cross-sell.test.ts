import assert from "node:assert/strict";
import { test } from "node:test";
import { crossSell, matrixGrid, type MatrixCell, type MatrixData } from "./cross-sell.ts";

// tienda → { producto: [pedidos en el período, pedidos en 90 días] }
function data(stores: Record<string, Record<string, [number, number]>>, days = 30): MatrixData {
  const cells: MatrixCell[] = [];
  for (const [s, ps] of Object.entries(stores)) {
    for (const [p, [n, n90]] of Object.entries(ps)) cells.push({ account_id: "a", store_id: s, product_key: p, n, n90 });
  }
  const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0);
  return {
    days,
    accounts: [{ account_id: "a", account_name: "Drop Honduras", currency: "HNL" }],
    stores: Object.entries(stores).map(([s, ps]) => ({
      account_id: "a", store_id: s, name: `Tienda ${s}`,
      orders: sum(Object.values(ps).map((x) => x[0])), orders90: sum(Object.values(ps).map((x) => x[1])),
      skus: Object.values(ps).filter((x) => x[0] > 0).length,
    })),
    products: [...new Set(cells.map((c) => c.product_key))].map((p) => ({
      account_id: "a", product_key: p, name: p,
      orders: sum(cells.filter((c) => c.product_key === p).map((c) => c.n)),
      orders90: sum(cells.filter((c) => c.product_key === p).map((c) => c.n90)),
      stores90: cells.filter((c) => c.product_key === p).length,
    })),
    cells,
  };
}

test("venta cruzada: nunca probó el producto que venden casi todas las tiendas con su mismo principal", () => {
  const d = data({
    A: { Shilajit: [300, 400] },
    B: { Shilajit: [40, 60], Semilla: [20, 30] },
    C: { Shilajit: [30, 40], Semilla: [10, 15] },
    D: { Shilajit: [20, 25], Semilla: [5, 8], Faja: [3, 3] },
    E: { Faja: [50, 60] },
  });
  const items = crossSell(d).filter((i) => i.store_id === "A");
  const cs = items.find((i) => i.kind === "cross_sell")!;
  assert.equal(cs.product_key, "Semilla");
  assert.equal(cs.title, "Tienda A vende mucho Shilajit pero nunca probó Semilla");
  assert.match(cs.detail, /^3 de 3 tiendas que venden Shilajit también venden Semilla/);
  // Faja: solo 1 de 3 → no se sugiere
  assert.ok(!items.some((i) => i.product_key === "Faja" && i.kind === "cross_sell"));
  // vende un solo producto y mueve 10 pedidos/día → ofrecer un segundo producto (el mismo sugerido)
  const one = items.find((i) => i.kind === "single_product")!;
  assert.equal(one.title, "📦 Tienda A vende solo 1 producto y mueve 10 pedidos/día");
  assert.equal(one.product_key, "Semilla");
});

test("lo vendido en 90 días cuenta como probado aunque no esté en el período", () => {
  const d = data({
    A: { Shilajit: [300, 400], Semilla: [0, 2] },
    B: { Shilajit: [40, 60], Semilla: [20, 30] },
    C: { Shilajit: [30, 40], Semilla: [10, 15] },
  });
  assert.ok(!crossSell(d).some((i) => i.store_id === "A" && i.kind === "cross_sell"));
});

test("sin tiendas parecidas suficientes no se sugiere nada", () => {
  const d = data({ A: { X: [100, 100] }, B: { X: [10, 10], Y: [5, 5] } });
  assert.ok(!crossSell(d).some((i) => i.kind === "cross_sell"));
});

test("cuadrícula: tiendas y productos principales, y producto dominante si pasa del 50%", () => {
  const d = data({
    A: { P1: [80, 80], P2: [20, 20] },
    B: { P1: [10, 10], P2: [10, 10], P3: [10, 10] },
  });
  const g = matrixGrid(d, "a", { stores: 2, products: 2 });
  assert.deepEqual(g.products.map((p) => p.product_key), ["P1", "P2"]);
  assert.equal(g.moreProducts, 1);
  assert.deepEqual(g.rows[0].cells, [80, 20]);
  assert.equal(g.rows[0].top, 0);
  assert.equal(g.rows[0].dominant, true);
  assert.equal(g.rows[1].dominant, false);
  // con muy pocos pedidos no hay dominante aunque sea el 100%
  assert.equal(matrixGrid(data({ A: { P1: [2, 2] } }), "a").rows[0].dominant, false);
});
