import assert from "node:assert/strict";
import { test } from "node:test";
import { change, concentration, deliveryRate, otherCountries, parsePeriod, readProducts, type ProductRow } from "./business.ts";

const p = (name: string, country: string, units: number, prev_units: number): ProductRow => ({
  account: `Drop ${country}`, country, name, units, prev_units, stores: 1, delivered: 0, failed: 0, vendor_usd: 0,
});

test("variación: sin base no hay porcentaje", () => {
  assert.equal(change(4619, 519), 790);
  assert.equal(change(36, 152), -76);
  assert.equal(change(10, 0), null);
});

test("tasa de entrega sobre pedidos cerrados", () => {
  assert.equal(deliveryRate(3, 1), 0.75);
  assert.equal(deliveryRate(0, 0), null);
});

test("período: solo 7, 30 o 90; por defecto 30", () => {
  assert.equal(parsePeriod("7"), 7);
  assert.equal(parsePeriod("45"), 30);
  assert.equal(parsePeriod(undefined), 30);
});

test("concentración de las primeras tiendas", () => {
  const top = [100, 50, 30, 10, 5, 5].map((cur, i) => ({ account: "a", country: "HN", name: `t${i}`, cur, prev: 0, flow: "steady" as const }));
  const c = concentration(top, 200);
  assert.equal(c.top1, 0.5);
  assert.equal(c.top3, 0.9);
  assert.equal(c.top5, 0.975);
});

test("lectura de productos por volumen y tendencia", () => {
  const rows = [p("A", "HN", 400, 100), p("B", "HN", 300, 500), p("C", "HN", 20, 5), p("D", "HN", 10, 40), p("E", "HN", 0, 60)];
  const r = readProducts(rows);
  assert.equal(r.get(rows[0]), "scale");
  assert.equal(r.get(rows[1]), "defend");
  assert.equal(r.get(rows[2]), "emerging");
  assert.equal(r.get(rows[3]), "review");
  assert.equal(r.get(rows[4]), "stopped");
});

test("otros países con el mismo producto (sin importar mayúsculas ni tildes)", () => {
  const rows = [p("Sovexa Cayenne Pepper", "HN", 800, 50), p("sovexa cayenne  pepper", "SV", 39, 0), p("Pelador", "GT", 98, 30)];
  const o = otherCountries(rows);
  assert.deepEqual(o.get(rows[0]), ["SV"]);
  assert.deepEqual(o.get(rows[1]), ["HN"]);
  assert.deepEqual(o.get(rows[2]), []);
});
