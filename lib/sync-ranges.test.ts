import assert from "node:assert/strict";
import { test } from "node:test";
import { rangeChunks } from "./sync-ranges.ts";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 16);

test("45 días en tramos de una semana, del más nuevo al más viejo, con un minuto de solape", () => {
  const c = rangeChunks(d("2026-09-01"), d("2026-10-16"));
  assert.equal(c.length, 7);
  assert.deepEqual([iso(c[0].from), iso(c[0].to)], ["2026-10-08T23:59", "2026-10-16T00:00"]);
  assert.deepEqual([iso(c[1].from), iso(c[1].to)], ["2026-10-01T23:59", "2026-10-09T00:00"]);
  assert.deepEqual([iso(c[6].from), iso(c[6].to)], ["2026-09-01T00:00", "2026-09-04T00:00"]); // el último no pasa del inicio
  // cubren todo el rango sin huecos: cada tramo empieza antes de que termine el siguiente más nuevo
  for (let i = 1; i < c.length; i++) assert.ok(c[i].to.getTime() > c[i - 1].from.getTime());
  for (let i = 1; i < c.length; i++) assert.ok(c[i].to <= c[i - 1].to);
});

test("un rango corto es un solo tramo; uno vacío, ninguno", () => {
  assert.equal(rangeChunks(d("2026-10-10"), d("2026-10-12")).length, 1);
  assert.deepEqual(rangeChunks(d("2026-10-12"), d("2026-10-12")), []);
  assert.deepEqual(rangeChunks(d("2026-10-13"), d("2026-10-12")), []);
});
