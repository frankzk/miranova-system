import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeCatalog, inspectExport, mapProduct, marginPctOf, parseCatalogExport, parseCsv, toNum,
  type CatalogProduct,
} from "./catalog.ts";

// ─── toNum: limpieza de números sucios ───

test("toNum limpia símbolos y separadores", () => {
  assert.equal(toNum("c5999.00"), 5999);
  assert.equal(toNum("c12,498.50"), 12498.5);
  assert.equal(toNum("₡5 999,00"), 5999); // europeo: coma decimal
  assert.equal(toNum("1.234.567,89"), 1234567.89); // miles con punto
  assert.equal(toNum("+108.34%"), 108.34);
  assert.equal(toNum(2999), 2999);
  assert.equal(toNum(""), null);
  assert.equal(toNum("—"), null);
  assert.equal(toNum(null), null);
});

// ─── Mapeo tolerante de campos ───

test("mapProduct reconoce nombres de campo variados y anidados", () => {
  const p = mapProduct({
    productName: "King maker",
    vendor: { name: "Ecomfive Costa Rica" },
    code: "ID-IUFSV",
    totalStock: 200,
    vendorPrice: "c5499.00",
    suggestedPrice: "c11748.50",
    country: { currencyName: "CRC" },
    productImage: "https://x/y.jpg",
  });
  assert.equal(p.name, "King maker");
  assert.equal(p.vendor, "Ecomfive Costa Rica");
  assert.equal(p.id, "ID-IUFSV");
  assert.equal(p.stock, 200);
  assert.equal(p.cost, 5499);
  assert.equal(p.suggested, 11748.5);
  assert.equal(p.currency, "CRC");
});

test("mapProduct usa moneda de respaldo si el export no la trae clara", () => {
  const p = mapProduct({ name: "X", price: 1 }, "HNL");
  assert.equal(p.currency, "HNL");
});

// ─── parseCatalogExport: envolturas y CSV ───

test("parseCatalogExport desenvuelve arreglos anidados", () => {
  const arr = parseCatalogExport({ data: { items: [{ name: "A", vendorPrice: 10, suggestedPrice: 20 }] } });
  assert.equal(arr.length, 1);
  assert.equal(arr[0].name, "A");
});

test("parseCatalogExport acepta JSON como cadena", () => {
  const arr = parseCatalogExport('[{"name":"A","vendorPrice":10,"suggestedPrice":25}]');
  assert.equal(arr.length, 1);
  assert.equal(arr[0].suggested, 25);
});

test("parseCsv con encabezados en español del listado de Drop", () => {
  const csv = [
    "Producto,Proveedor,ID,Total,Precio proveedor,Precio sugerido",
    'King maker,Ecomfive Costa Rica,ID-IUFSV,200,"c5,499.00","c11,748.50"',
    "Yerba Magic,Ecomfive Costa Rica,ID-EOX96,200,c5731.95,c11688.50",
  ].join("\n");
  const ps = parseCsv(csv);
  assert.equal(ps.length, 2);
  assert.equal(ps[0].name, "King maker");
  assert.equal(ps[0].cost, 5499);
  assert.equal(ps[0].suggested, 11748.5);
  assert.equal(ps[1].vendor, "Ecomfive Costa Rica");
});

test("parseCatalogExport enruta a CSV cuando la cadena no es JSON", () => {
  const csv = "Producto,Precio proveedor,Precio sugerido\nX,10,20";
  const ps = parseCatalogExport(csv);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].cost, 10);
});

// ─── marginPctOf ───

test("marginPctOf evita dividir por cero", () => {
  assert.equal(marginPctOf({ cost: 100, suggested: 250 } as CatalogProduct), 1.5);
  assert.equal(marginPctOf({ cost: 0, suggested: 20 } as CatalogProduct), null);
  assert.equal(marginPctOf({ cost: 100, suggested: null } as CatalogProduct), null);
});

// ─── analyzeCatalog ───

const SAMPLE: CatalogProduct[] = [
  { id: "1", name: "King maker", vendor: "Ecomfive", stock: 200, cost: 5499, suggested: 11748.5, currency: "CRC", image: null },
  { id: "2", name: "Yerba Magic", vendor: "Ecomfive", stock: 200, cost: 5731.95, suggested: 11688.5, currency: "CRC", image: null },
  { id: "3", name: "Bee Venom", vendor: "Ecomfive", stock: 0, cost: 4099, suggested: 9648.5, currency: "CRC", image: null },
  { id: "4", name: "Collagen", vendor: "OtroProveedor", stock: 50, cost: 9448.95, suggested: 16998.5, currency: "CRC", image: null },
  { id: "5", name: "Bee Venom", vendor: "OtroProveedor", stock: 120, cost: 3800, suggested: 9000, currency: "CRC", image: null },
  { id: "6", name: "Sin precio", vendor: null, stock: null, cost: null, suggested: null, currency: "CRC", image: null },
];

test("resumen cuenta productos, proveedores y faltantes", () => {
  const a = analyzeCatalog(SAMPLE);
  assert.equal(a.summary.products, 6);
  assert.equal(a.summary.vendors, 2);
  assert.equal(a.summary.withPrices, 5);
  assert.equal(a.summary.outOfStock, 1);
  assert.equal(a.currency, "CRC");
});

test("estadística de margen sobre productos con ambos precios", () => {
  const a = analyzeCatalog(SAMPLE);
  assert.ok(a.marginPct);
  // margen de Bee Venom (OtroProveedor): (9000-3800)/3800 ≈ 1.368
  assert.ok(a.marginPct!.max > 1.3);
  assert.ok(a.marginPct!.min > 0);
});

test("ranking por proveedor ordenado por cantidad", () => {
  const a = analyzeCatalog(SAMPLE);
  assert.equal(a.byVendor[0].vendor, "Ecomfive");
  assert.equal(a.byVendor[0].products, 3);
  assert.ok(a.byVendor[0].costRange);
});

test("detecta el mismo producto en varios proveedores y marca el más barato", () => {
  const a = analyzeCatalog(SAMPLE);
  const dup = a.duplicates.find((d) => d.name === "Bee Venom");
  assert.ok(dup, "debería agrupar Bee Venom");
  assert.equal(dup!.offers, 2);
  assert.equal(dup!.vendors.length, 2);
  assert.equal(dup!.cheapest!.vendor, "OtroProveedor");
  assert.equal(dup!.cheapest!.cost, 3800);
  assert.equal(dup!.spread, 299); // 4099 - 3800
});

test("bestEntry prioriza costo bajo con buen margen", () => {
  const a = analyzeCatalog(SAMPLE);
  assert.ok(a.bestEntry.length > 0);
  // todos los de bestEntry deben estar en o por debajo de la mediana de costo
  const medianCost = a.cost!.median;
  assert.ok(a.bestEntry.every((p) => p.cost! <= medianCost));
});

test("issues avisa de productos sin precio y sin proveedor", () => {
  const a = analyzeCatalog(SAMPLE);
  assert.ok(a.issues.some((s) => s.includes("sin costo")));
  assert.ok(a.issues.some((s) => s.includes("sin proveedor")));
});

test("catálogo vacío no truena", () => {
  const a = analyzeCatalog([]);
  assert.equal(a.summary.products, 0);
  assert.equal(a.cost, null);
  assert.equal(a.marginPct, null);
  assert.deepEqual(a.topMargin, []);
});

// ─── inspectExport ───

test("inspectExport reporta claves crudas y el mapeo de la primera fila", () => {
  const info = inspectExport('[{"productName":"A","vendorPrice":10,"suggestedPrice":20,"weirdKey":1}]');
  assert.equal(info.count, 1);
  assert.ok(info.rawKeys.includes("weirdKey"));
  assert.equal(info.sample!.mapped.name, "A");
  assert.equal(info.sample!.mapped.cost, 10);
});
