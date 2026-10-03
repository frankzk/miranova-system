import assert from "node:assert/strict";
import { test } from "node:test";
import type { CatalogChange, CatalogMovement } from "./catalog.ts";
import {
  applyCatalogFilters, catalogContext, catalogFacets, catalogQuery, countryOfCurrency, parseCatalogFilters, priceBand,
  sortCatalog, type CatalogFilters,
} from "./catalog-filters.ts";

const item = (o: Partial<CatalogMovement>): CatalogMovement => ({
  id: "A", name: "Producto", vendor: "Prov", stock: 50, cost: 100, suggested: null, currency: "HNL", image: null,
  unitsDown: 0, unitsUp: 0, stockChanges: 0, lastMove: null, ...o,
});
const change = (o: Partial<CatalogChange>): CatalogChange => ({
  name: "Producto", vendor: "Prov", code: "A", currency: "HNL", takenAt: "2026-10-01T00:00:00Z",
  prevCost: null, cost: null, prevSuggested: null, suggested: null, prevStock: null, stock: null, ...o,
});
const F = (o: Partial<CatalogFilters> = {}): CatalogFilters => ({ q: "", tab: "", ...o });

const items = [
  item({ id: "H1", name: "Drenaje linfático", vendor: "SUPLEM HN", cost: 206, stock: 876, unitsDown: 97, stockChanges: 2, lastMove: "2026-10-02" }),
  item({ id: "H2", name: "Cojín ortopédico", vendor: "DISTRIHONDURAS", cost: 155, stock: 0, unitsDown: 5, stockChanges: 1, lastMove: "2026-10-03" }),
  item({ id: "H3", name: "Hair growth", vendor: "SUPLEM HN", cost: 187, stock: 4174 }),
  item({ id: "H4", name: "Santa escalador", vendor: "BAMBU", cost: 214, stock: 5, unitsUp: 40, stockChanges: 1, lastMove: "2026-09-20" }),
  item({ id: "C1", name: "Mini cámara", vendor: "Bionatural", cost: 8350, stock: 12, currency: "CRC" }),
  item({ id: "C2", name: "Faja", vendor: "Bionatural", cost: 4000, stock: null, currency: "CRC", unitsDown: 3, stockChanges: 1 }),
];
const changes = [
  change({ code: "H2", prevStock: 5, stock: 0 }),
  change({ code: "H4", prevCost: 230, cost: 214 }),
  change({ code: "H4", prevStock: 0, stock: 45 }),
  change({ code: "C1", prevSuggested: 9000, suggested: 9500 }), // precio sugerido: no es un filtro
];
const ctx = catalogContext(items, changes);

test("parseCatalogFilters descarta valores desconocidos", () => {
  const f = parseCatalogFilters({ q: " gotas ", f: "moving", pais: "HNL", prov: "SUPLEM HN", precio: "low", cambio: "cost_down", sort: "cost_asc" });
  assert.deepEqual(f, { q: "gotas", tab: "moving", country: "HNL", vendor: "SUPLEM HN", price: "low", change: "cost_down", sort: "cost_asc" });
  const bad = parseCatalogFilters({ f: "nope", pais: "honduras", precio: "x", cambio: "price_up", sort: "drop" });
  assert.deepEqual(bad, { q: "", tab: "", country: undefined, vendor: undefined, price: undefined, change: undefined, sort: undefined });
});

test("catalogQuery omite vacíos y aplica cambios", () => {
  const f = F({ tab: "out", vendor: "BAMBU" });
  assert.equal(catalogQuery(f), "f=out&prov=BAMBU");
  assert.equal(catalogQuery(f, { prov: undefined, sort: "name_asc" }), "f=out&sort=name_asc");
});

test("countryOfCurrency: país único o la moneda si es ambigua", () => {
  assert.equal(countryOfCurrency("HNL"), "Honduras");
  assert.equal(countryOfCurrency("CRC"), "Costa Rica");
  assert.equal(countryOfCurrency("USD"), "USD");
});

test("tercios de precio se calculan dentro de cada moneda", () => {
  // HNL: 155, 187, 206, 214 → cortes 187 y 206; CRC: 4000, 8350 → cortes 4000 y 8350
  assert.deepEqual(ctx.cuts.get("HNL"), [187, 206]);
  assert.deepEqual(ctx.cuts.get("CRC"), [4000, 8350]);
  assert.equal(priceBand(items[1], ctx), "low");
  assert.equal(priceBand(items[2], ctx), "low");
  assert.equal(priceBand(items[0], ctx), "mid");
  assert.equal(priceBand(items[3], ctx), "high");
  // ₡8,350 contra los cortes en lempiras sería "caro"; dentro de colones es "medio"
  assert.equal(priceBand(items[4], ctx), "mid");
});

test("cambios por código: costo, quiebre y reabasto; el precio sugerido no cuenta", () => {
  assert.deepEqual([...(ctx.changes.get("H4") ?? [])].sort(), ["cost_down", "restock"]);
  assert.deepEqual([...(ctx.changes.get("H2") ?? [])], ["stockout"]);
  assert.equal(ctx.changes.has("C1"), false);
});

test("búsqueda sin acentos por nombre, proveedor o código", () => {
  assert.deepEqual(applyCatalogFilters(items, F({ q: "linfatico" }), ctx).map((m) => m.id), ["H1"]);
  assert.deepEqual(applyCatalogFilters(items, F({ q: "suplem" }), ctx).map((m) => m.id), ["H1", "H3"]);
  assert.deepEqual(applyCatalogFilters(items, F({ q: "c1" }), ctx).map((m) => m.id), ["C1"]);
});

test("pestañas: movimiento, reabasto, stock bajo, agotados, quietos", () => {
  const ids = (tab: CatalogFilters["tab"]) => applyCatalogFilters(items, F({ tab }), ctx).map((m) => m.id).sort();
  assert.deepEqual(ids("moving"), ["C2", "H1", "H2"]);
  assert.deepEqual(ids("restock"), ["H4"]);
  assert.deepEqual(ids("low"), ["H4"]);
  assert.deepEqual(ids("out"), ["H2"]);
  assert.deepEqual(ids("still"), ["C1", "H3"]);
});

test("conteos por faceta: cada filtro cuenta con los demás aplicados", () => {
  const f = F({ country: "HNL", vendor: "SUPLEM HN" });
  const fx = catalogFacets(items, f, ctx);
  // pestañas: dentro de SUPLEM en HNL
  assert.equal(fx.tabs[""], 2);
  assert.equal(fx.tabs.moving, 1);
  // proveedores: ignoran el filtro de proveedor pero respetan el país
  assert.equal(fx.vendors.all, 4);
  assert.deepEqual(fx.vendors.options.map((o) => [o.value, o.count]), [["SUPLEM HN", 2], ["BAMBU", 1], ["DISTRIHONDURAS", 1]]);
  // países: ignoran el país pero respetan el proveedor
  assert.deepEqual(fx.countries.options.map((o) => [o.label, o.count]), [["Honduras", 2]]);
  // la suma de las opciones de una faceta cuadra con su "todos"
  assert.equal(fx.prices.options.reduce((t, o) => t + o.count, 0), fx.prices.all);
});

test("el proveedor elegido sigue en la lista aunque quede en 0", () => {
  const fx = catalogFacets(items, F({ country: "CRC", vendor: "BAMBU" }), ctx);
  assert.deepEqual(fx.vendors.options.find((o) => o.value === "BAMBU"), { value: "BAMBU", label: "BAMBU", count: 0 });
});

test("con una sola moneda, los tercios de precio dicen su rango", () => {
  const hn = catalogFacets(items, F({ country: "HNL" }), ctx);
  assert.equal(hn.prices.options[0].label, "Más baratos · hasta L 187.00");
  assert.equal(hn.prices.options[1].label, "Precio medio · L 187.00 – L 206.00");
  assert.equal(hn.prices.options[2].label, "Más caros · más de L 206.00");
  const mixed = catalogFacets(items, F(), ctx);
  assert.equal(mixed.prices.options[0].label, "Más baratos");
});

test("filtro de cambios cuenta productos, no eventos", () => {
  const fx = catalogFacets(items, F(), ctx);
  assert.deepEqual(fx.changes.options.map((o) => [o.value, o.count]), [["cost_down", 1], ["cost_up", 0], ["stockout", 1], ["restock", 1]]);
  assert.deepEqual(applyCatalogFilters(items, F({ change: "cost_down" }), ctx).map((m) => m.id), ["H4"]);
});

test("orden: por defecto lo que más se mueve; precio agrupado por moneda y sin dato al final", () => {
  assert.deepEqual(sortCatalog(items).map((m) => m.id).slice(0, 3), ["H1", "H2", "C2"]);
  assert.deepEqual(sortCatalog(items, "cost_asc").map((m) => m.id), ["C2", "C1", "H2", "H3", "H1", "H4"]);
  assert.deepEqual(sortCatalog(items, "cost_desc").map((m) => m.id), ["C1", "C2", "H4", "H1", "H3", "H2"]);
  assert.deepEqual(sortCatalog(items, "stock_asc").map((m) => m.id), ["H2", "H4", "C1", "H1", "H3", "C2"]);
  assert.deepEqual(sortCatalog(items, "recent").map((m) => m.id).slice(0, 3), ["H2", "H1", "H4"]);
  assert.equal(sortCatalog(items, "restock")[0].id, "H4");
});
