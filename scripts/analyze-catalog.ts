#!/usr/bin/env node
// Analizador del catálogo de proveedores de Drop a partir de un export manual.
//
// Export manual (una de estas dos):
//   A) JSON — en el catálogo de Drop abre DevTools → Network → busca la llamada a
//      api.soydrop.com del listado → clic derecho → "Copy response" → pégala en un
//      archivo, p. ej. catalogo.json.
//   B) CSV — pega el listado con encabezados: Producto,Proveedor,ID,Total,
//      Precio proveedor,Precio sugerido
//
// Uso:
//   node --experimental-strip-types scripts/analyze-catalog.ts catalogo.json
//   cat catalogo.json | node --experimental-strip-types scripts/analyze-catalog.ts
//   node --experimental-strip-types scripts/analyze-catalog.ts catalogo.json --inspect
//   node --experimental-strip-types scripts/analyze-catalog.ts catalogo.json --json
//   node --experimental-strip-types scripts/analyze-catalog.ts catalogo.json --currency HNL

import { readFileSync } from "node:fs";
import { analyzeCatalog, inspectExport, parseCatalogExport, type ScoredProduct } from "../lib/catalog.ts";
import { fmtInt, fmtMoney } from "../lib/format.ts";

type Args = { file: string | null; inspect: boolean; json: boolean; currency: string; top: number };

function parseArgs(argv: string[]): Args {
  const a: Args = { file: null, inspect: false, json: false, currency: "CRC", top: 10 };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--inspect") a.inspect = true;
    else if (v === "--json") a.json = true;
    else if (v === "--currency") a.currency = (argv[++i] ?? "CRC").toUpperCase();
    else if (v === "--top") a.top = Math.max(1, Number(argv[++i]) || 10);
    else if (!v.startsWith("--")) a.file = v;
  }
  return a;
}

function readInput(file: string | null): string {
  if (file) return readFileSync(file, "utf8");
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

const pct = (x: number | null) => (x === null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);
const bar = (n: number, max: number, width = 24) => "█".repeat(Math.round((max ? n / max : 0) * width)).padEnd(width, "·");

function line(label: string, value: string) {
  return `  ${label.padEnd(22)} ${value}`;
}

function productRow(p: ScoredProduct, cur: string): string {
  const name = p.name.length > 34 ? p.name.slice(0, 33) + "…" : p.name;
  const vendor = (p.vendor ?? "—").length > 20 ? (p.vendor ?? "—").slice(0, 19) + "…" : p.vendor ?? "—";
  return `  ${pct(p.marginPct).padStart(8)}  ${name.padEnd(35)} ${vendor.padEnd(21)} ${fmtMoney(p.cost, cur).padStart(12)} → ${fmtMoney(p.suggested, cur).padStart(12)}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = readInput(args.file);
  if (!raw.trim()) {
    console.error("Sin datos. Pasa un archivo o envía el export por stdin.\nEj: node --experimental-strip-types scripts/analyze-catalog.ts catalogo.json");
    process.exit(1);
  }

  // JSON o CSV: el parser decide. Para --inspect e --json necesitamos el valor parseado.
  let parsed: unknown = raw;
  const trimmed = raw.trim();
  if (trimmed[0] === "{" || trimmed[0] === "[") {
    try { parsed = JSON.parse(trimmed); } catch { parsed = raw; }
  }

  if (args.inspect) {
    const info = inspectExport(parsed, { currency: args.currency });
    console.log(`Registros encontrados: ${info.count}`);
    console.log(`\nClaves del primer registro (${info.rawKeys.length}):`);
    console.log("  " + (info.rawKeys.join(", ") || "(ninguna — ¿es un arreglo de objetos?)"));
    if (info.sample) {
      console.log("\nMapeo de la primera fila:");
      for (const [k, val] of Object.entries(info.sample.mapped)) {
        const ok = val !== null && val !== "Producto sin nombre" ? "✓" : "·";
        console.log(line(`${ok} ${k}`, String(val)));
      }
      console.log("\nSi algún campo quedó en null, dime cómo se llama en 'Claves del primer registro'");
      console.log("y lo agrego a las listas de candidatos en lib/catalog.ts.");
    }
    return;
  }

  const products = parseCatalogExport(parsed, { currency: args.currency });
  const a = analyzeCatalog(products, { top: args.top });

  if (args.json) { console.log(JSON.stringify(a, null, 2)); return; }

  const cur = a.currency;
  console.log(`\n═══ Catálogo Drop · análisis competitivo ═══\n`);
  console.log(line("Productos", fmtInt(a.summary.products)));
  console.log(line("Proveedores", fmtInt(a.summary.vendors)));
  console.log(line("Con precio (margen)", fmtInt(a.summary.withPrices)));
  console.log(line("Stock total", fmtInt(a.summary.totalStock)));
  console.log(line("Agotados", fmtInt(a.summary.outOfStock)));

  if (a.cost && a.suggested && a.marginPct) {
    console.log(`\n── Precios y margen ──`);
    console.log(line("Costo (min/med/max)", `${fmtMoney(a.cost.min, cur)} / ${fmtMoney(a.cost.median, cur)} / ${fmtMoney(a.cost.max, cur)}`));
    console.log(line("Sugerido (min/med/max)", `${fmtMoney(a.suggested.min, cur)} / ${fmtMoney(a.suggested.median, cur)} / ${fmtMoney(a.suggested.max, cur)}`));
    console.log(line("Margen (min/med/max)", `${pct(a.marginPct.min)} / ${pct(a.marginPct.median)} / ${pct(a.marginPct.max)}`));

    const maxBucket = Math.max(1, ...a.marginBuckets.map((b) => b.count));
    console.log(`\n── Distribución de margen ──`);
    for (const b of a.marginBuckets) console.log(`  ${b.label.padEnd(10)} ${bar(b.count, maxBucket)} ${fmtInt(b.count)}`);
  }

  if (a.byVendor.length) {
    console.log(`\n── Por proveedor ──`);
    console.log(`  ${"Proveedor".padEnd(28)} ${"Prod".padStart(5)} ${"Margen med".padStart(11)}  Rango costo`);
    for (const v of a.byVendor.slice(0, 15)) {
      const name = v.vendor.length > 27 ? v.vendor.slice(0, 26) + "…" : v.vendor;
      const range = v.costRange ? `${fmtMoney(v.costRange[0], cur)}–${fmtMoney(v.costRange[1], cur)}` : "—";
      console.log(`  ${name.padEnd(28)} ${fmtInt(v.products).padStart(5)} ${pct(v.medianMarginPct).padStart(11)}  ${range}`);
    }
  }

  if (a.bestEntry.length) {
    console.log(`\n── Mejor primer producto para pautar (costo bajo + buen margen) ──`);
    console.log(`  ${"Margen".padStart(8)}  ${"Producto".padEnd(35)} ${"Proveedor".padEnd(21)} ${"Costo".padStart(12)}    ${"Sugerido".padStart(12)}`);
    for (const p of a.bestEntry) console.log(productRow(p, cur));
  }

  if (a.topMargin.length) {
    console.log(`\n── Mayor margen % ──`);
    for (const p of a.topMargin) console.log(productRow(p, cur));
  }

  if (a.duplicates.length) {
    console.log(`\n── Mismo producto en varios proveedores (¿quién lo da más barato?) ──`);
    for (const d of a.duplicates.slice(0, 15)) {
      const name = d.name.length > 34 ? d.name.slice(0, 33) + "…" : d.name;
      const cheap = d.cheapest ? `${fmtMoney(d.cheapest.cost, cur)} (${d.cheapest.vendor ?? "—"})` : "—";
      const spread = d.spread ? `Δ ${fmtMoney(d.spread, cur)}` : "";
      console.log(`  ${name.padEnd(35)} ${fmtInt(d.offers)} ofertas  más barato: ${cheap}  ${spread}`);
    }
  }

  if (a.issues.length) {
    console.log(`\n── Avisos ──`);
    for (const s of a.issues) console.log(`  • ${s}`);
  }
  console.log("");
}

main();
