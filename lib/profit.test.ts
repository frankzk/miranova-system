import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanProfitProduct, dailyTotals, marketEconomics, margin, monthBuckets, nameSimilarity, observedPrices, parseMoney, profitPeriod, realize,
  suggestLinks, unitCosts, weekBuckets, windowStart, type Delivered, type ProfitProduct,
} from "./profit.ts";

const HN = "hn";
const SV = "sv";
const ACCOUNTS = [{ id: HN, name: "Drop Honduras" }, { id: SV, name: "Drop El Salvador" }];
const close = (a: number | null | undefined, b: number, eps = 0.005) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < eps, `${a} ≈ ${b}`);

const product = (over: Partial<ProfitProduct> = {}): ProfitProduct => ({
  id: "p1", name: "Drenaje linfático en gotas", cost_currency: "USD", fx_gtq_per_usd: null,
  unit_cost: 2.5, import_cost: 0.5, pickup_cost: 0.2, notes: null,
  markets: [
    { account_id: HN, carrier: "raulito", transfer_cost: 0.6, price_community: 215, price_users: 236, qty_in: 1000 },
    { account_id: SV, carrier: "castaneda", transfer_cost: 0.4, price_community: 9.3, price_users: 9.7, qty_in: null },
  ],
  links: [{ account_id: HN, product_key: "dlg-hn" }, { account_id: SV, product_key: "dlg-sv" }],
  ...over,
});

test("montos: acepta símbolos y comas; texto que no es número da NaN", () => {
  assert.equal(parseMoney("1,234.50"), 1234.5);
  assert.equal(parseMoney("$12"), 12);
  assert.equal(parseMoney("Q 12.5"), 12.5);
  assert.equal(parseMoney("L236"), 236);
  assert.equal(parseMoney(""), null);
  assert.ok(Number.isNaN(parseMoney("doce")));
});

test("ficha: costo total, puesto en el país y rentabilidad comunidad / usuarios", () => {
  const p = product();
  const c = unitCosts(p, p.markets[0]);
  // costo total = 2.50 + 0.50; puesto en HN = 3.00 + 0.20 recolección + 0.60 traslado
  close(c.cost_total, 3);
  close(c.landed, 3.8);
  const e = marketEconomics(p, p.markets[0], 0.04);
  // L236 × 0.04 = $9.44 − 3.80 − 1.20 fulfillment = $4.44
  close(e.users?.price_usd, 9.44);
  close(e.users?.profit, 4.44);
  close(e.community?.profit, 215 * 0.04 - 3.8 - 1.2);
  close(e.investment, 3800);
  // sin costo no hay rentabilidad
  assert.equal(marketEconomics(product({ unit_cost: null }), p.markets[0], 0.04).users, null);
});

test("costos en quetzales: se pasan a dólares con el tipo de cambio de la ficha", () => {
  const p = product({ cost_currency: "GTQ", fx_gtq_per_usd: 7.5, unit_cost: 15, import_cost: null, pickup_cost: 3 });
  const c = unitCosts(p, { transfer_cost: 4.5 });
  close(c.cost_total, 2);
  close(c.landed, 2 + 0.4 + 0.6);
});

test("lempiras: convierte todos los costos por la tasa HNL, sin usar la de GTQ", () => {
  const p = product({ cost_currency: "HNL", fx_hnl_per_usd: 25, fx_gtq_per_usd: 7.65,
    unit_cost: 62.5, import_cost: 12.5, pickup_cost: 5 });
  const m = { ...p.markets[0], transfer_cost: 15 };
  const c = unitCosts(p, m);
  close(c.cost_total, 3);
  close(c.pickup, 0.2);
  close(c.transfer, 0.6);
  close(c.landed, 3.8);
  close(marketEconomics(p, m, 0.04).users?.profit, 4.44);
  assert.equal(unitCosts({ ...p, fx_hnl_per_usd: null }, m).cost_total, null);
});

test("formulario HNL: persiste la tasa propia y rechaza tasas vacías, invertidas y monedas desconocidas", () => {
  const input = { name: "Honduras", cost_currency: "HNL", fx_hnl_per_usd: "25", fx_gtq_per_usd: "7.65", unit_cost: "L 62.50" };
  const r = cleanProfitProduct(input, ACCOUNTS);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.row.cost_currency, "HNL");
    assert.equal(r.row.unit_cost, 62.5);
    assert.equal(r.row.fx_hnl_per_usd, 25);
    assert.equal(r.row.fx_gtq_per_usd, null);
  }
  for (const rate of ["", "0", "-1", "0.04", "abc", "1001"]) {
    assert.equal(cleanProfitProduct({ ...input, fx_hnl_per_usd: rate }, ACCOUNTS).ok, false);
  }
  assert.equal(cleanProfitProduct({ ...input, cost_currency: "INVALID" }, ACCOUNTS).ok, false);
});

test("formulario: valida, limpia y guarda solo las cuentas con datos", () => {
  const r = cleanProfitProduct(
    {
      name: "  Drenaje   linfático ", cost_currency: "GTQ", fx_gtq_per_usd: "7.65", unit_cost: "Q12.50", import_cost: "", pickup_cost: "2",
      markets: { [HN]: { carrier: "raulito", transfer_cost: "4", price_community: "215", price_users: "L236", qty_in: "1,000" }, [SV]: { carrier: "" } },
      links: [`${HN}|dlg-hn`, `${HN}|dlg-hn`, "otra|x", `${SV}|`],
    },
    ACCOUNTS,
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.row, { name: "Drenaje linfático", cost_currency: "GTQ", fx_gtq_per_usd: 7.65, fx_hnl_per_usd: null, unit_cost: 12.5, import_cost: null, pickup_cost: 2, notes: null });
  assert.deepEqual(r.markets, [{ account_id: HN, carrier: "raulito", transfer_cost: 4, price_community: 215, price_users: 236, qty_in: 1000 }]);
  assert.deepEqual(r.links, [{ account_id: HN, product_key: "dlg-hn" }]);
});

test("formulario: errores claros", () => {
  const msg = (input: Parameters<typeof cleanProfitProduct>[0]) => {
    const r = cleanProfitProduct(input, ACCOUNTS);
    return r.ok ? null : r.msg;
  };
  assert.match(msg({ name: " " }) ?? "", /nombre/);
  assert.match(msg({ name: "X", cost_currency: "GTQ" }) ?? "", /tipo de cambio/);
  assert.match(msg({ name: "X", cost_currency: "GTQ", fx_gtq_per_usd: "0.13" }) ?? "", /quetzales por dólar/);
  assert.match(msg({ name: "X", unit_cost: "tres" }) ?? "", /El costo debe ser un número/);
  assert.match(msg({ name: "X", markets: { [SV]: { price_users: "nueve" } } }) ?? "", /^Drop El Salvador: el precio usuarios/);
  assert.match(msg({ name: "X", markets: { [HN]: { qty_in: "10.5" } } }) ?? "", /entero/);
});

test("nombres parecidos entre países", () => {
  assert.equal(nameSimilarity("Cinturón sin Hebilla Pack de 5", "Cinturon sin hebilla"), 1);
  const s = suggestLinks("Pulsera Magnética de Cobre Con Cristales Verdes", [
    { account_id: SV, product_key: "a", name: "Pulsera Magnética de Cobre Saludable Cooper" },
    { account_id: SV, product_key: "b", name: "Pulsera Magnética de Cobre Con Cristales Verdes Pulsera Magnética de Cobre Con Cristales Ver" },
    { account_id: HN, product_key: "c", name: "Auto Wash Water Gun" },
    { account_id: HN, product_key: "d", name: "Pulsera Cristales Verdes" },
  ], new Set([`${HN}|d`]));
  assert.equal(s.get(SV)?.product_key, "b");
  // la de HN ya está en otra ficha y la otra no se parece
  assert.equal(s.has(HN), false);
});

const DATA: Delivered = {
  rows: [
    // HN: 3 a precio usuarios y 2 a comunidad; Drop descontó L33 por pedido
    { d: "2026-10-02", a: HN, k: "dlg-hn", p: 236, u: 3, v: 708, f: 99, x: null, n: 3 },
    { d: "2026-10-03", a: HN, k: "dlg-hn", p: 215, u: 2, v: 430, f: 33, x: null, n: 1 },
    // SV sin el dato de lo descontado: se estima el fulfillment fijo
    { d: "2026-10-03", a: SV, k: "dlg-sv", p: 9.7, u: 1, v: 9.7, f: null, x: 1, n: 1 },
    // sin ficha
    { d: "2026-10-03", a: HN, k: "otro", p: 250, u: 1, v: 250, f: 33, x: null, n: 1 },
    // fuera del período
    { d: "2026-09-30", a: HN, k: "dlg-hn", p: 236, u: 10, v: 2360, f: 330, x: null, n: 10 },
  ],
  orders: [{ d: "2026-10-02", a: HN, n: 3 }, { d: "2026-10-03", a: HN, n: 2 }, { d: "2026-10-03", a: SV, n: 1 }, { d: "2026-09-30", a: HN, n: 10 }],
  names: { [`${HN}:otro`]: "Auto Wash Water Gun" },
};
const RATES = new Map<string, number | null>([[HN, 0.04], [SV, 1]]);

test("utilidad real: lo cobrado − lo que descontó Drop − costo puesto, solo de lo que tiene costo", () => {
  const r = realize(DATA, [product()], RATES, { from: "2026-10-01", to: "2026-10-31" });
  const t = r.totals;
  assert.equal(t.orders, 6);
  assert.equal(t.units, 7);
  // HN: (708 + 430) × 0.04 = 45.52; SV: 9.70; sin ficha: 250 × 0.04 = 10
  close(t.revenue, 45.52 + 9.7 + 10);
  close(t.covered_revenue, 45.52 + 9.7);
  // descuentos: (99 + 33) × 0.04 = 5.28 y 1.20 estimado en SV
  close(t.covered_fees, 5.28 + 1.2);
  // costo: 5 × 3.80 (HN) + 1 × 3.60 (SV)
  close(t.cost, 19 + 3.6);
  close(t.profit, 45.52 + 9.7 - 6.48 - 22.6);
  close(margin(t), (45.52 + 9.7 - 6.48 - 22.6) / 55.22);
  assert.deepEqual([t.community_units, t.users_units], [2, 4]);
  assert.equal(r.products.length, 1);
  assert.deepEqual(r.products[0].accounts.sort(), [HN, SV]);
  assert.deepEqual(r.unlinked, [{ account_id: HN, key: "otro", name: "Auto Wash Water Gun", units: 1, revenue: 10, orders: 1 }]);
  // filtro por cuenta
  close(realize(DATA, [product()], RATES, { from: "2026-10-01", to: "2026-10-31", account: SV }).totals.revenue, 9.7);
});

test("ficha sin costo: cuenta lo cobrado, pero no entra en la utilidad", () => {
  const r = realize(DATA, [product({ unit_cost: null })], RATES, { from: "2026-10-01", to: "2026-10-31" });
  assert.equal(r.totals.profit, 0);
  assert.equal(r.totals.covered_revenue, 0);
  assert.equal(r.products[0].has_cost, false);
  assert.equal(margin(r.totals), null);
});

test("precios observados: los dos más cobrados, de menor a mayor", () => {
  assert.deepEqual(observedPrices(DATA.rows, HN, "dlg-hn", "2026-10-01"), [215, 236]);
  assert.deepEqual(observedPrices(DATA.rows, HN, "dlg-hn", "2026-10-03"), [215]);
});

test("períodos: comparación justa contra el mismo tramo", () => {
  const today = "2026-10-24";
  assert.deepEqual(profitPeriod("mes", today).prev, {
    from: "2026-09-01", to: "2026-09-24", label: "en septiembre al mismo día (1–24 sept)", name: "septiembre al mismo día",
  });
  // el 31 se compara contra el último día de un mes de 30
  assert.equal(profitPeriod("mes", "2026-10-31").prev.to, "2026-09-30");
  const w = profitPeriod("semana", today); // sábado
  assert.deepEqual([w.from, w.prev.from, w.prev.to], ["2026-10-19", "2026-10-12", "2026-10-17"]);
  const mp = profitPeriod("mes-pasado", today);
  assert.deepEqual([mp.from, mp.to, mp.prev.from, mp.prev.to], ["2026-09-01", "2026-09-30", "2026-08-01", "2026-08-31"]);
  const c = profitPeriod("custom", today, { from: "2026-10-10", to: "2026-10-01" });
  assert.deepEqual([c.from, c.to, c.prev.from, c.prev.to], ["2026-10-01", "2026-10-10", "2026-09-21", "2026-09-30"]);
  assert.equal(profitPeriod("custom", today, { to: "2027-01-01" }).to, today);
  assert.equal(profitPeriod(undefined, today).id, "mes");
  assert.equal(windowStart(today, profitPeriod("mes", today)), "2026-05-01");
});

test("comparativos por mes y por semana", () => {
  const daily = dailyTotals(DATA, [product()], RATES);
  const m = monthBuckets(daily, "2026-10-24", 3);
  assert.deepEqual(m.buckets.map((b) => b.key), ["2026-08", "2026-09", "2026-10"]);
  assert.equal(m.buckets[2].acc.orders, 6);
  assert.equal(m.buckets[1].acc.orders, 10);
  assert.equal(m.prevToDate.orders, 0); // el 30 de septiembre no entra en el tramo 1–24
  const w = weekBuckets(daily, "2026-10-07", 2);
  assert.deepEqual(w.buckets.map((b) => [b.from, b.to]), [["2026-09-28", "2026-10-04"], ["2026-10-05", "2026-10-07"]]);
  assert.equal(w.buckets[0].acc.orders, 16);
  assert.equal(w.prevToDate.orders, 10); // lunes 28 a miércoles 30
});
