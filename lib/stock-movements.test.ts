import assert from "node:assert/strict";
import { test } from "node:test";
import { extractMovements, movementTotal, orderNumberFrom } from "./stock-movements.ts";

test("lee la lista aunque venga anidada y saca el número de orden de la descripción", () => {
  const payload = {
    status: "success",
    data: {
      movements: [
        { _id: "m45", movementNumber: 45, quantity: -1, createdAt: "2026-09-14T16:11:00.000Z", description: "Salida por orden #1789240822725" },
        { _id: "m1", movementNumber: 1, quantity: 50, type: "entrada", createdAt: "2026-09-06T22:31:00.000Z", description: "Ingreso de inventario" },
      ],
      pagination: { total: 45, page: 1, limit: 10 },
    },
  };
  const m = extractMovements(payload);
  assert.equal(m.length, 2);
  assert.deepEqual([m[0].external_id, m[0].number, m[0].units, m[0].order_number], ["m45", 45, -1, "1789240822725"]);
  assert.deepEqual([m[1].units, m[1].order_number, m[1].occurred_at], [50, null, "2026-09-06T22:31:00.000Z"]);
  assert.equal(movementTotal(payload), 45);
});

test("cantidad sin signo en una salida se guarda negativa; sin ID usa el número", () => {
  const [a] = extractMovements([{ number: 7, units: 2, type: "OUT", description: "Salida por orden #178926" }]);
  assert.deepEqual([a.external_id, a.units], ["n:7", -2]);
  const [b] = extractMovements({ items: [{ id: "x", amount: 3, type: "entrada" }] });
  assert.equal(b.units, 3);
  assert.equal(orderNumberFrom("Salida por orden 1789318146819"), "1789318146819");
  assert.deepEqual(extractMovements({ nada: true }), []);
});
