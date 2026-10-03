// Análisis del catálogo de proveedores de Drop (inteligencia competitiva).
//
// La fuente es un "export manual": el JSON que la web de Drop ya carga en el
// catálogo (api.soydrop.com) o el mismo listado pegado como CSV. Como la API no
// está documentada, el parser busca cada campo entre varios nombres posibles
// (igual que lib/normalize.ts) y es tolerante con símbolos de moneda y separadores.
//
// Todo es puro (sin servidor) para poder probarlo y reusarlo en el panel.

// ─── Tipos ───

export type CatalogProduct = {
  /** Código visible (ID-XXXX) o id interno. */
  id: string | null;
  name: string;
  /** Proveedor que ofrece el producto. */
  vendor: string | null;
  /** Existencias declaradas ("200 total"). */
  stock: number | null;
  /** Precio proveedor: lo que te cuesta surtirlo. */
  cost: number | null;
  /** Precio sugerido de venta. */
  suggested: number | null;
  currency: string;
  image: string | null;
};

export type Stats = { min: number; median: number; max: number; avg: number };

export type VendorStat = {
  vendor: string;
  currency: string;
  products: number;
  /** Productos con costo y sugerido (para medir margen). */
  withPrices: number;
  medianMarginPct: number | null;
  avgMarginPct: number | null;
  costRange: [number, number] | null;
  suggestedRange: [number, number] | null;
  totalStock: number;
};

export type ScoredProduct = CatalogProduct & {
  margin: number;
  marginPct: number;
};

export type DuplicateGroup = {
  /** Nombre representativo (el más frecuente del grupo). */
  name: string;
  currency: string;
  offers: number;
  vendors: string[];
  costRange: [number, number] | null;
  /** Proveedor con el costo más bajo y su precio. */
  cheapest: { vendor: string | null; cost: number } | null;
  /** Diferencia entre el costo más caro y el más barato (absoluta). */
  spread: number | null;
};

export type CatalogAnalysis = {
  currency: string;
  summary: {
    products: number;
    vendors: number;
    withPrices: number;
    totalStock: number;
    outOfStock: number;
  };
  cost: Stats | null;
  suggested: Stats | null;
  marginPct: Stats | null;
  /** Distribución del margen % en tramos. */
  marginBuckets: { label: string; count: number }[];
  byVendor: VendorStat[];
  /** Mejores por margen %. */
  topMargin: ScoredProduct[];
  /** Buen primer producto para pautar: costo bajo + margen alto. */
  bestEntry: ScoredProduct[];
  /** Mismo producto ofrecido por varios proveedores (o varias veces). */
  duplicates: DuplicateGroup[];
  /** Avisos de datos: productos sin precio, sin proveedor, etc. */
  issues: string[];
};

// ─── Utilidades tolerantes ───

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Primer string no vacío entre las claves candidatas (admite ruta "a.b"). */
function pickStr(rec: Obj, keys: string[]): string | null {
  for (const key of keys) {
    const v = getPath(rec, key);
    if (v === null || v === undefined) continue;
    const t = String(v).trim();
    if (t !== "") return t;
  }
  return null;
}

/** Primer número válido entre las claves candidatas (limpia "c5,999.00", "₡5 999", "+108%"). */
function pickNum(rec: Obj, keys: string[]): number | null {
  for (const key of keys) {
    const v = getPath(rec, key);
    const x = toNum(v);
    if (x !== null) return x;
  }
  return null;
}

function getPath(rec: Obj, key: string): unknown {
  if (key.indexOf(".") === -1) return rec[key];
  let cur: unknown = rec;
  for (const part of key.split(".")) {
    if (!isObj(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Convierte valores sucios ("c12,498.50", "₡5 999,00", "+108.34%") a número. */
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let t = String(v).trim();
  if (t === "") return null;
  // quita todo menos dígitos, separadores y signo
  t = t.replace(/[^\d.,-]/g, "");
  if (t === "" || t === "-" || t === "." || t === ",") return null;
  const hasDot = t.includes(".");
  const hasComma = t.includes(",");
  if (hasDot && hasComma) {
    // el último separador que aparece es el decimal
    if (t.lastIndexOf(",") > t.lastIndexOf(".")) t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(/,/g, "");
  } else if (hasComma) {
    // solo comas: decimal si hay una con 1-2 dígitos al final, si no son miles
    const parts = t.split(",");
    if (parts.length === 2 && parts[1].length >= 1 && parts[1].length <= 2) t = `${parts[0]}.${parts[1]}`;
    else t = t.replace(/,/g, "");
  }
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
}

// ─── Parseo del export ───

const ARRAY_KEYS = ["data", "items", "products", "rows", "docs", "results", "catalog", "list", "content", "records", "edges", "nodes"];

/** Encuentra el arreglo de productos dentro de cualquier envoltura razonable. */
function findArray(input: unknown, depth = 0): unknown[] {
  if (Array.isArray(input)) return input;
  if (!isObj(input) || depth > 4) return [];
  for (const k of ARRAY_KEYS) {
    const v = input[k];
    if (Array.isArray(v)) return v;
  }
  // baja un nivel por las envolturas comunes
  for (const k of [...ARRAY_KEYS, "pagination", "page", "response", "payload"]) {
    const v = input[k];
    if (isObj(v)) {
      const found = findArray(v, depth + 1);
      if (found.length) return found;
    }
  }
  return [];
}

// Candidatos alineados con lib/products.ts (vocabulario real de la API de Drop).
const NAME_KEYS = ["name", "productName", "product_name", "title", "nombre", "displayName", "label"];
const ID_KEYS = ["shortId", "displayId", "code", "publicId", "referenceId", "productCode", "reference", "sku", "productId", "product_id", "id", "_id"];
const VENDOR_KEYS = ["vendorName", "vendor.name", "vendor", "proveedor", "supplierName", "supplier.name", "supplier", "provider", "providerName", "store.name", "storeName"];
const STOCK_KEYS = ["totalAvailable", "totalStock", "totalInventory", "stock", "total", "available", "availableStock", "inventory", "quantity", "existencias", "qty", "inventory.total", "stock.total"];
const COST_KEYS = ["vendorPrice", "providerPrice", "supplierPrice", "cost", "costPrice", "basePrice", "wholesalePrice", "precioProveedor", "prices.vendor", "price.vendor", "pricing.vendorPrice", "pricing.cost", "price"];
const SUGGESTED_KEYS = ["suggestedPrice", "sellerPrice", "recommendedPrice", "salePrice", "retailPrice", "pvp", "precioSugerido", "suggested", "prices.suggested", "price.suggested", "pricing.suggestedPrice", "pricing.suggested"];
const CURRENCY_KEYS = ["currency", "currencyCode", "currencyName", "country.currencyName", "country.currencyId"];
const IMAGE_KEYS = ["productImage", "image", "imageUrl", "image_url", "thumbnail", "img", "photo", "cover", "images.0"];

/** Normaliza un registro del export a CatalogProduct (tolerante con los nombres de campo). */
export function mapProduct(rec: Obj, fallbackCurrency = "CRC"): CatalogProduct {
  const rawCurrency = pickStr(rec, CURRENCY_KEYS);
  // Toma un código de 3 letras (CRC, HNL, USD…); si no parece código, usa el de respaldo.
  const currency = rawCurrency && /^[A-Za-z]{3}$/.test(rawCurrency) ? rawCurrency.toUpperCase() : fallbackCurrency;
  return {
    id: pickStr(rec, ID_KEYS),
    name: pickStr(rec, NAME_KEYS) ?? "Producto sin nombre",
    vendor: pickStr(rec, VENDOR_KEYS),
    stock: pickNum(rec, STOCK_KEYS),
    cost: pickNum(rec, COST_KEYS),
    suggested: pickNum(rec, SUGGESTED_KEYS),
    currency,
    image: pickStr(rec, IMAGE_KEYS),
  };
}

/** ¿El objeto parece un producto de catálogo (y no una orden)? */
function looksLikeProduct(o: Obj): boolean {
  if (getPath(o, "orderInfo") !== undefined || getPath(o, "productSnapshots") !== undefined) return false;
  if (pickStr(o, NAME_KEYS) === null) return false;
  return pickNum(o, COST_KEYS) !== null || pickNum(o, SUGGESTED_KEYS) !== null || pickNum(o, STOCK_KEYS) !== null;
}

/** Camina el valor y junta los objetos que parecen productos (para formas anidadas raras). */
function deepCollect(value: unknown, depth = 0, out: Obj[] = []): Obj[] {
  if (depth > 6 || value === null || typeof value !== "object") return out;
  if (Array.isArray(value)) { for (const v of value) deepCollect(v, depth + 1, out); return out; }
  if (looksLikeProduct(value as Obj)) out.push(value as Obj);
  else for (const v of Object.values(value)) deepCollect(v, depth + 1, out);
  return out;
}

/** De un valor ya parseado: el arreglo de productos (ruta rápida) o lo que encuentre caminando. */
function collectFromValue(value: unknown): Obj[] {
  const arr = findArray(value);
  return (arr.length ? arr : deepCollect(value)).filter(isObj);
}

/** ¿Parece un payload RSC/"flight" de Next.js? (líneas tipo `0:{…}` / `1a:[…]`). */
function looksLikeFlight(t: string): boolean {
  return /^[0-9a-f]+:[[{]/m.test(t);
}

/** Extrae productos de un payload flight: parsea cada fila JSON y junta lo que parezca producto. */
function collectFromFlight(text: string): Obj[] {
  const out: Obj[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const m = /^[0-9a-f]+:(.*)$/.exec(line.trim());
    if (!m) continue;
    const body = m[1].trim();
    if (body[0] !== "{" && body[0] !== "[") continue;
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { continue; }
    for (const r of deepCollect(parsed)) {
      const key = `${pickStr(r, ID_KEYS) ?? ""}|${pickStr(r, NAME_KEYS) ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

/** Descubre los objetos crudos de producto en cualquier entrada; señala si hay que tratarla como CSV. */
function rawObjects(input: unknown): { objs: Obj[]; csv?: string } {
  if (typeof input === "string") {
    const t = input.trim();
    if (t === "") return { objs: [] };
    if (t[0] === "{" || t[0] === "[") {
      try { return { objs: collectFromValue(JSON.parse(t)) }; } catch { return { objs: [], csv: t }; }
    }
    if (looksLikeFlight(t)) return { objs: collectFromFlight(t) };
    return { objs: [], csv: t };
  }
  return { objs: collectFromValue(input) };
}

/**
 * Parsea un export de catálogo. Acepta:
 *  - un valor ya parseado (arreglo o envoltura con `data`/`items`/…),
 *  - una cadena JSON,
 *  - el payload RSC/"flight" de Next.js (lo que devuelve `app.soydrop.com/...?_rsc=`),
 *  - una cadena CSV (con encabezados en español o inglés).
 */
export function parseCatalogExport(input: unknown, opts: { currency?: string } = {}): CatalogProduct[] {
  const currency = opts.currency ?? "CRC";
  const { objs, csv } = rawObjects(input);
  if (csv !== undefined) return parseCsv(csv, currency);
  return objs.map((r) => mapProduct(r, currency));
}

// ─── CSV (encabezados del listado de Drop) ───

const CSV_HEADER_MAP: { field: keyof CatalogProduct; names: string[] }[] = [
  { field: "name", names: ["producto", "nombre", "name", "product", "title"] },
  { field: "vendor", names: ["proveedor", "vendor", "supplier", "provider"] },
  { field: "id", names: ["id", "codigo", "código", "sku", "referencia", "code"] },
  { field: "stock", names: ["total", "stock", "existencias", "inventario", "cantidad"] },
  { field: "cost", names: ["precio proveedor", "precioproveedor", "costo", "cost", "vendor price"] },
  { field: "suggested", names: ["precio sugerido", "preciosugerido", "sugerido", "suggested", "precio venta", "pvp"] },
];

export function parseCsv(text: string, currency = "CRC"): CatalogProduct[] {
  const rows = csvRows(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const colOf = (field: keyof CatalogProduct) => {
    const names = CSV_HEADER_MAP.find((m) => m.field === field)?.names ?? [];
    for (let i = 0; i < header.length; i++) if (names.includes(header[i])) return i;
    return -1;
  };
  const idx = {
    name: colOf("name"), vendor: colOf("vendor"), id: colOf("id"),
    stock: colOf("stock"), cost: colOf("cost"), suggested: colOf("suggested"),
  };
  const get = (row: string[], i: number) => (i >= 0 && i < row.length ? row[i] : "");
  return rows.slice(1).filter((r) => r.some((c) => c.trim() !== "")).map((r) => ({
    id: get(r, idx.id).trim() || null,
    name: get(r, idx.name).trim() || "Producto sin nombre",
    vendor: get(r, idx.vendor).trim() || null,
    stock: toNum(get(r, idx.stock)),
    cost: toNum(get(r, idx.cost)),
    suggested: toNum(get(r, idx.suggested)),
    currency,
    image: null,
  }));
}

/** Divide un CSV en filas/celdas respetando comillas dobles. */
function csvRows(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const push = () => { row.push(cell); cell = ""; };
  const end = () => { push(); out.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") push();
    else if (c === "\n") end();
    else if (c === "\r") { /* ignora */ }
    else cell += c;
  }
  if (cell !== "" || row.length) end();
  return out;
}

// ─── Estadística ───

function stats(xs: number[]): Stats | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return { min: s[0], max: s[s.length - 1], median: median(s), avg: s.reduce((t, x) => t + x, 0) / s.length };
}

/** Mediana de un arreglo YA ordenado. */
function median(sorted: number[]): number {
  const n = sorted.length;
  if (!n) return 0;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export const marginPctOf = (p: CatalogProduct): number | null =>
  p.cost !== null && p.suggested !== null && p.cost > 0 ? (p.suggested - p.cost) / p.cost : null;

/** Proveedor que ofrece un producto, buscado entre los nombres de campo posibles del payload crudo. */
export function pickVendor(raw: unknown): string | null {
  return isObj(raw) ? pickStr(raw, VENDOR_KEYS) : null;
}

// ─── Cambios en el tiempo (precio / stock) ───

/** Una foto del producto comparada con la anterior (de la función SQL catalog_changes). */
export type CatalogChange = {
  name: string;
  vendor: string | null;
  code: string | null;
  currency: string;
  takenAt: string;
  prevCost: number | null;
  cost: number | null;
  prevSuggested: number | null;
  suggested: number | null;
  prevStock: number | null;
  stock: number | null;
};

export type ChangeTag = {
  kind: "price_down" | "price_up" | "cost_down" | "cost_up" | "stockout" | "restock" | "stock_down" | "stock_up";
  /** Dirección para colorear: baja / sube / aviso / neutro. */
  tone: "down" | "up" | "warning" | "neutral";
  label: string;
};

/** Producto del catálogo con su movimiento de stock en una ventana de días. */
export type CatalogMovement = CatalogProduct & {
  /** Unidades que salieron de stock (lo que la competencia movió/vendió). */
  unitsDown: number;
  /** Unidades que entraron (reabastos). */
  unitsUp: number;
  stockChanges: number;
  lastMove: string | null;
};

const relPct = (prev: number, cur: number): number | null => (prev !== 0 ? Math.round(((cur - prev) / Math.abs(prev)) * 100) : null);
const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

/** Qué cambió entre la foto anterior y la nueva: re-precio, cambio de costo, quiebre o reabasto. */
export function changeTags(c: CatalogChange): ChangeTag[] {
  const tags: ChangeTag[] = [];

  if (c.prevSuggested !== null && c.suggested !== null && c.suggested !== c.prevSuggested) {
    const down = c.suggested < c.prevSuggested;
    const pct = relPct(c.prevSuggested, c.suggested);
    tags.push({ kind: down ? "price_down" : "price_up", tone: down ? "down" : "up", label: `Precio ${pct !== null ? `${signed(pct)}%` : down ? "baja" : "sube"}` });
  }

  if (c.prevCost !== null && c.cost !== null && c.cost !== c.prevCost) {
    const down = c.cost < c.prevCost;
    const pct = relPct(c.prevCost, c.cost);
    tags.push({ kind: down ? "cost_down" : "cost_up", tone: down ? "down" : "up", label: `Costo ${pct !== null ? `${signed(pct)}%` : down ? "baja" : "sube"}` });
  }

  if (c.prevStock !== null && c.stock !== null && c.stock !== c.prevStock) {
    if (c.prevStock > 0 && c.stock === 0) tags.push({ kind: "stockout", tone: "warning", label: "Sin stock" });
    else if (c.prevStock === 0 && c.stock > 0) tags.push({ kind: "restock", tone: "up", label: "Reabastecido" });
    else { const down = c.stock < c.prevStock; tags.push({ kind: down ? "stock_down" : "stock_up", tone: "neutral", label: `Stock ${signed(c.stock - c.prevStock)}` }); }
  }

  return tags;
}

function normName(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

const MARGIN_BUCKETS: { label: string; max: number }[] = [
  { label: "< 50 %", max: 0.5 },
  { label: "50–100 %", max: 1.0 },
  { label: "100–150 %", max: 1.5 },
  { label: "150–200 %", max: 2.0 },
  { label: "≥ 200 %", max: Infinity },
];

// ─── Análisis ───

export function analyzeCatalog(products: CatalogProduct[], opts: { top?: number } = {}): CatalogAnalysis {
  const top = opts.top ?? 10;
  const currency = products.find((p) => p.currency)?.currency ?? "CRC";

  const withPrices: ScoredProduct[] = [];
  for (const p of products) {
    const mp = marginPctOf(p);
    if (mp !== null && p.cost !== null && p.suggested !== null) {
      withPrices.push({ ...p, margin: p.suggested - p.cost, marginPct: mp });
    }
  }

  const vendors = new Set(products.map((p) => p.vendor).filter((v): v is string => !!v));
  const totalStock = products.reduce((t, p) => t + (p.stock ?? 0), 0);
  const outOfStock = products.filter((p) => p.stock === 0).length;

  // Por proveedor
  const byVendorMap = new Map<string, CatalogProduct[]>();
  for (const p of products) {
    const key = p.vendor ?? "(sin proveedor)";
    (byVendorMap.get(key) ?? byVendorMap.set(key, []).get(key)!).push(p);
  }
  const byVendor: VendorStat[] = [...byVendorMap.entries()].map(([vendor, ps]) => {
    const margins = ps.map(marginPctOf).filter((x): x is number => x !== null);
    const costs = ps.map((p) => p.cost).filter((x): x is number => x !== null);
    const suggesteds = ps.map((p) => p.suggested).filter((x): x is number => x !== null);
    const mStats = stats(margins);
    return {
      vendor,
      currency: ps.find((p) => p.currency)?.currency ?? currency,
      products: ps.length,
      withPrices: margins.length,
      medianMarginPct: mStats?.median ?? null,
      avgMarginPct: mStats?.avg ?? null,
      costRange: costs.length ? [Math.min(...costs), Math.max(...costs)] as [number, number] : null,
      suggestedRange: suggesteds.length ? [Math.min(...suggesteds), Math.max(...suggesteds)] as [number, number] : null,
      totalStock: ps.reduce((t, p) => t + (p.stock ?? 0), 0),
    };
  }).sort((a, b) => b.products - a.products);

  // Rankings
  const topMargin = [...withPrices].sort((a, b) => b.marginPct - a.marginPct).slice(0, top);
  const costStats = stats(withPrices.map((p) => p.cost!));
  const medianCost = costStats?.median ?? Infinity;
  const bestEntry = withPrices
    .filter((p) => p.cost! <= medianCost)
    .sort((a, b) => b.marginPct - a.marginPct)
    .slice(0, top);

  // Distribución de margen
  const marginBuckets = MARGIN_BUCKETS.map((b, i) => {
    const lo = i === 0 ? -Infinity : MARGIN_BUCKETS[i - 1].max;
    return { label: b.label, count: withPrices.filter((p) => p.marginPct >= lo && p.marginPct < b.max).length };
  });

  // Duplicados (mismo producto, varios proveedores)
  // Se agrupa por nombre + moneda: comparar precios de distinta moneda no tiene sentido.
  const groups = new Map<string, CatalogProduct[]>();
  for (const p of products) {
    const k = normName(p.name);
    if (!k) continue;
    const key = `${k}\u0000${p.currency}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
  }
  const duplicates: DuplicateGroup[] = [...groups.values()]
    .filter((ps) => ps.length > 1)
    .map((ps) => {
      const costed = ps.filter((p) => p.cost !== null) as (CatalogProduct & { cost: number })[];
      const costs = costed.map((p) => p.cost);
      const cheapest = costed.length ? costed.reduce((a, b) => (b.cost < a.cost ? b : a)) : null;
      return {
        name: mostCommonName(ps),
        currency: ps[0].currency,
        offers: ps.length,
        vendors: [...new Set(ps.map((p) => p.vendor).filter((v): v is string => !!v))],
        costRange: costs.length ? [Math.min(...costs), Math.max(...costs)] as [number, number] : null,
        cheapest: cheapest ? { vendor: cheapest.vendor, cost: cheapest.cost } : null,
        spread: costs.length ? Math.max(...costs) - Math.min(...costs) : null,
      };
    })
    .sort((a, b) => b.offers - a.offers || (b.spread ?? 0) - (a.spread ?? 0));

  // Avisos
  const issues: string[] = [];
  const noPrice = products.length - withPrices.length;
  if (noPrice > 0) issues.push(`${noPrice} producto(s) sin costo o sugerido: no se pudo medir su margen.`);
  const noVendor = products.filter((p) => !p.vendor).length;
  if (noVendor > 0) issues.push(`${noVendor} producto(s) sin proveedor identificado.`);
  if (products.length && !withPrices.length) issues.push("Ningún producto trae precio: revisa el mapeo de campos con `--inspect`.");

  return {
    currency,
    summary: { products: products.length, vendors: vendors.size, withPrices: withPrices.length, totalStock, outOfStock },
    cost: costStats,
    suggested: stats(withPrices.map((p) => p.suggested!)),
    marginPct: stats(withPrices.map((p) => p.marginPct)),
    marginBuckets,
    byVendor,
    topMargin,
    bestEntry,
    duplicates,
    issues,
  };
}

function mostCommonName(ps: CatalogProduct[]): string {
  const counts = new Map<string, number>();
  for (const p of ps) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Para el modo --inspect del CLI: muestra qué claves trae el export y cómo quedó el mapeo. */
export function inspectExport(input: unknown, opts: { currency?: string } = {}): {
  count: number;
  rawKeys: string[];
  sample: { raw: Obj; mapped: CatalogProduct } | null;
} {
  const { objs } = rawObjects(input);
  const first = objs[0] ?? null;
  return {
    count: objs.length,
    rawKeys: first ? Object.keys(first) : [],
    sample: first ? { raw: first, mapped: mapProduct(first, opts.currency ?? "CRC") } : null,
  };
}
