import assert from "node:assert/strict";
import { test } from "node:test";
import { monthLong, monthShort, visibleMonths, type ActiveMonth } from "./active-months.ts";

const m = (k: number, month: string, active: number, orders = active * 10): ActiveMonth => ({ k, month, active, new: 0, orders });

test("meses visibles: sin los vacíos del principio, con los del medio", () => {
  const list = [m(4, "2026-06", 0), m(3, "2026-07", 0), m(2, "2026-08", 5), m(1, "2026-09", 0), m(0, "2026-10", 3)];
  assert.deepEqual(visibleMonths(list).map((x) => x.month), ["2026-08", "2026-09", "2026-10"]);
  assert.deepEqual(visibleMonths([m(0, "2026-10", 0)]), []);
  assert.deepEqual(visibleMonths(undefined), []);
});

test("nombres de mes: cortos, con año solo si es otro año", () => {
  assert.equal(monthShort("2026-05", "2026-10"), "may");
  assert.equal(monthShort("2025-12", "2026-02"), "dic 25");
  assert.match(monthShort("2026-09", "2026-10"), /^sept?$/);
  assert.equal(monthLong("2026-09"), "septiembre 2026");
});
