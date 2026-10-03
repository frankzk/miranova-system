import assert from "node:assert/strict";
import { test } from "node:test";
import type { CatalogChange, CatalogMovement } from "./catalog.ts";
import {
  applyCatalogFilters, catalogContext, catalogFacets, catalogQuery, countryOfCurrency, parseCatalogFilters, priceBand,
  inStockRange, sortCatalog, stockBand, type CatalogFilters,
} from "./catalog-filters.ts";

const item = (o: Partial<CatalogMovement>): CatalogMovement => ({
  id: "A", name: "Producto", vendor: "Prov", stock: 50, cost: 100, suggested: null, currency: "HNL", image: null,
  unitsDown: 0, unitsUp: 0, stockChanges: 0, lastMove: null, ...o,
});
const change = (o: Partial<CatalogChange>): CatalogChange => ({
  name: "Producto", vendor: "Prov", code: "A", currency: "HNL", takenAt: "2026-10-01T00:00:00Z",
  prevCost: null, cost: null, prevSuggested: null, suggested: null, prevStock: null, stock: null, ...o,
});
const F = (o: Partial<CatalogFilters> = {}): CatalogFilters => ({
  q: "", tab: "", countries: [], vendors: [], stocks: [], stockMin: undefined, stockMax: undefined, prices: [], changes: [], ...o,
});

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

test("parseCatalogFilters: listas repetidas, sin duplicados ni valores desconocidos", () => {
  const f = parseCatalogFilters({
    q: " gotas ", f: "moving", pais: ["HNL", "CRC"], prov: ["SUPLEM HN", "BAMBU", "SUPLEM HN"], stock: ["1-10", "mas-1000"],
    precio: "low", cambio: ["cost_down", "restock"], sort: "cost_asc",
  });
  assert.deepEqual(f, {
    q: "gotas", tab: "moving", countries: ["HNL", "CRC"], vendors: ["SUPLEM HN", "BAMBU"], stocks: ["1-10", "mas-1000"],
    stockMin: undefined, stockMax: undefined, prices: ["low"], changes: ["cost_down", "restock"], sort: "cost_asc",
  });
  const bad = parseCatalogFilters({ f: "nope", pais: "honduras", stock: "1000+", precio: ["x", "high"], cambio: "price_up", sort: "drop" });
  assert.deepEqual(bad, {
    q: "", tab: "", countries: [], vendors: [], stocks: [], stockMin: undefined, stockMax: undefined, prices: ["high"], changes: [], sort: undefined,
  });
});

test("catalogQuery omite vacíos, repite las listas y aplica cambios", () => {
  const f = F({ tab: "out", vendors: ["BAMBU", "SUPLEM HN"], stocks: ["0"], stockMin: 0, stockMax: 300 });
  assert.equal(catalogQuery(f), "f=out&prov=BAMBU&prov=SUPLEM+HN&stock=0&smin=0&smax=300");
  assert.equal(
    catalogQuery(f, { prov: ["SUPLEM HN"], stock: undefined, smin: undefined, smax: undefined, sort: "name_asc" }),
    "f=out&prov=SUPLEM+HN&sort=name_asc",
  );
  // ida y vuelta por la URL
  const url = new URLSearchParams(catalogQuery(f));
  const sp = Object.fromEntries([...new Set(url.keys())].map((k) => [k, url.getAll(k)]));
  assert.deepEqual(parseCatalogFilters(sp), { ...f, sort: undefined });
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
  const f = F({ countries: ["HNL"], vendors: ["SUPLEM HN"] });
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
  const fx = catalogFacets(items, F({ countries: ["CRC"], vendors: ["BAMBU"] }), ctx);
  assert.deepEqual(fx.vendors.options.find((o) => o.value === "BAMBU"), { value: "BAMBU", label: "BAMBU", count: 0 });
});

test("con una sola moneda, los tercios de precio dicen su rango", () => {
  const hn = catalogFacets(items, F({ countries: ["HNL"] }), ctx);
  assert.equal(hn.prices.options[0].label, "Más baratos · hasta L 187.00");
  assert.equal(hn.prices.options[1].label, "Precio medio · L 187.00 – L 206.00");
  assert.equal(hn.prices.options[2].label, "Más caros · más de L 206.00");
  const mixed = catalogFacets(items, F(), ctx);
  assert.equal(mixed.prices.options[0].label, "Más baratos");
  assert.equal(catalogFacets(items, F({ countries: ["HNL", "CRC"] }), ctx).prices.options[0].label, "Más baratos");
});

test("filtro de cambios cuenta productos, no eventos", () => {
  const fx = catalogFacets(items, F(), ctx);
  assert.deepEqual(fx.changes.options.map((o) => [o.value, o.count]), [["cost_down", 1], ["cost_up", 0], ["stockout", 1], ["restock", 1]]);
  assert.deepEqual(applyCatalogFilters(items, F({ changes: ["cost_down"] }), ctx).map((m) => m.id), ["H4"]);
  assert.deepEqual(applyCatalogFilters(items, F({ changes: ["cost_down", "stockout"] }), ctx).map((m) => m.id).sort(), ["H2", "H4"]);
});

test("orden: por defecto lo que más se mueve; precio agrupado por moneda y sin dato al final", () => {
  assert.deepEqual(sortCatalog(items).map((m) => m.id).slice(0, 3), ["H1", "H2", "C2"]);
  assert.deepEqual(sortCatalog(items, "cost_asc").map((m) => m.id), ["C2", "C1", "H2", "H3", "H1", "H4"]);
  assert.deepEqual(sortCatalog(items, "cost_desc").map((m) => m.id), ["C1", "C2", "H4", "H1", "H3", "H2"]);
  assert.deepEqual(sortCatalog(items, "stock_asc").map((m) => m.id), ["H2", "H4", "C1", "H1", "H3", "C2"]);
  assert.deepEqual(sortCatalog(items, "recent").map((m) => m.id).slice(0, 3), ["H2", "H1", "H4"]);
  assert.equal(sortCatalog(items, "restock")[0].id, "H4");
});

test("rangos de stock: bordes incluidos, sin dato fuera de todos", () => {
  const at = (stock: number | null) => stockBand(item({ stock }));
  assert.equal(at(0), "0");
  assert.equal(at(1), "1-10");
  assert.equal(at(10), "1-10");
  assert.equal(at(11), "11-50");
  assert.equal(at(200), "51-200");
  assert.equal(at(1000), "201-1000");
  assert.equal(at(1001), "mas-1000");
  assert.equal(at(null), null);
  const fx = catalogFacets(items, F(), ctx);
  assert.deepEqual(fx.stocks.options.map((o) => [o.value, o.count]), [
    ["0", 1], ["1-10", 1], ["11-50", 1], ["51-200", 0], ["201-1000", 1], ["mas-1000", 1],
  ]);
  // la Faja (stock sin dato) cuenta en "todos" pero en ningún rango
  assert.equal(fx.stocks.all - fx.stocks.options.reduce((t, o) => t + o.count, 0), 1);
});

test("selección múltiple: se suma dentro del filtro y se cruza entre filtros", () => {
  const ids = (f: Partial<CatalogFilters>) => applyCatalogFilters(items, F(f), ctx).map((m) => m.id).sort();
  assert.deepEqual(ids({ vendors: ["BAMBU", "Bionatural"] }), ["C1", "C2", "H4"]);
  assert.deepEqual(ids({ vendors: ["BAMBU", "Bionatural"], countries: ["CRC"] }), ["C1", "C2"]);
  assert.deepEqual(ids({ stocks: ["0", "1-10"] }), ["H2", "H4"]);
  assert.deepEqual(ids({ stocks: ["0", "1-10"], vendors: ["BAMBU"] }), ["H4"]);
  // con un proveedor marcado, los demás siguen contando lo que sumarían
  const fx = catalogFacets(items, F({ vendors: ["BAMBU"] }), ctx);
  assert.equal(fx.vendors.options.find((o) => o.value === "SUPLEM HN")?.count, 2);
  assert.equal(fx.tabs[""], 1);
});

test("rango de stock escrito: enteros, acepta comas e invierte si vienen al revés", () => {
  const r = (sp: Record<string, string>) => {
    const f = parseCatalogFilters(sp);
    return [f.stockMin, f.stockMax];
  };
  assert.deepEqual(r({ smin: "50", smax: "1,000" }), [50, 1000]);
  assert.deepEqual(r({ smin: "300", smax: "50" }), [50, 300]);
  assert.deepEqual(r({ smin: "0" }), [0, undefined]);
  assert.deepEqual(r({ smin: "-5", smax: "abc" }), [undefined, undefined]);
  assert.deepEqual(r({ smax: "12.5" }), [undefined, undefined]);
});

test("rango de stock escrito: filtra con bordes incluidos y deja fuera el stock sin dato", () => {
  assert.equal(inStockRange(item({ stock: 50 }), 50, 300), true);
  assert.equal(inStockRange(item({ stock: 300 }), 50, 300), true);
  assert.equal(inStockRange(item({ stock: 301 }), 50, 300), false);
  assert.equal(inStockRange(item({ stock: null }), undefined, 300), false);
  assert.equal(inStockRange(item({ stock: null })), true);
  const ids = (f: Partial<CatalogFilters>) => applyCatalogFilters(items, F(f), ctx).map((m) => m.id).sort();
  assert.deepEqual(ids({ stockMin: 5, stockMax: 900 }), ["C1", "H1", "H4"]);
  assert.deepEqual(ids({ stockMin: 1000 }), ["H3"]);
  assert.deepEqual(ids({ stockMax: 0 }), ["H2"]);
  // se cruza con los rangos fijos: (1–10 u. o 11–50 u.) y desde 11 → solo la cámara de 12 u.
  assert.deepEqual(ids({ stocks: ["1-10", "11-50"], stockMin: 11 }), ["C1"]);
});

test("rango de stock escrito: los conteos de los rangos fijos ya lo respetan", () => {
  const fx = catalogFacets(items, F({ stockMin: 5, stockMax: 900 }), ctx);
  assert.deepEqual(fx.stocks.options.map((o) => [o.value, o.count]), [
    ["0", 0], ["1-10", 1], ["11-50", 1], ["51-200", 0], ["201-1000", 1], ["mas-1000", 0],
  ]);
  assert.equal(fx.stocks.all, 3);
  assert.equal(fx.tabs[""], 3);
});
