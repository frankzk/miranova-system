// Convierte respuestas de la API de productos en filas normalizadas.
// El formato exacto de Drop se afina con los datos reales; `raw` guarda todo.

export type NormalizedProduct = {
  external_id: string;
  code: string | null;
  name: string;
  sku: string | null;
  status: string | null;
  price: number | null;
  suggested_price: number | null;
  stock: number | null;
  image_url: string | null;
  created_at_platform: string | null;
  raw: unknown;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const keyNorm = (k: string) => k.replace(/[^a-z0-9]/gi, "").toLowerCase();

function get(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (Array.isArray(cur) && /^\d+$/.test(part)) {
      cur = cur[Number(part)];
      continue;
    }
    if (!isObj(cur)) return undefined;
    const want = keyNorm(part);
    const k = Object.keys(cur).find((x) => keyNorm(x) === want);
    if (k === undefined) return undefined;
    cur = cur[k];
  }
  return cur;
}

function pick(obj: unknown, paths: string[]): unknown {
  for (const p of paths) {
    const v = get(obj, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

const str = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (isObj(v)) return str(pick(v, ["url", "src", "name", "label", "value"]));
  return null;
};

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.-]/g, ""));
    return v.trim() && Number.isFinite(n) ? n : null;
  }
  return null;
};

const F = {
  id: ["id", "_id", "productId", "uuid"],
  code: ["shortId", "code", "publicId", "displayId", "referenceId", "productCode", "slugId"],
  name: ["name", "title", "productName", "nombre"],
  sku: ["sku", "code", "barcode", "variants.0.sku"],
  status: ["status", "state", "estado"],
  price: ["vendorPrice", "price", "basePrice", "cost", "costPrice", "precio", "prices.vendor", "pricing.vendorPrice"],
  suggested: ["suggestedPrice", "sellerPrice", "recommendedPrice", "salePrice", "pricing.suggestedPrice", "prices.suggested"],
  stock: ["totalStock", "stock", "inventory", "totalInventory", "availableStock", "quantity", "inventory.total", "stock.total"],
  image: ["image", "imageUrl", "mainImage", "thumbnail", "productImage", "images.0", "images.0.url", "media.0.url", "photos.0"],
  created: ["createdAt", "created_at", "creationDate", "fechaCreacion"],
};

/** Si el inventario viene repartido por bodegas/variantes, lo suma. */
function stockOf(raw: Obj): number | null {
  const direct = num(pick(raw, F.stock));
  if (direct !== null) return Math.round(direct);
  for (const key of ["warehouses", "inventories", "stocks", "variants", "warehouseStocks"]) {
    const arr = get(raw, key);
    if (Array.isArray(arr) && arr.length) {
      const total = arr.reduce((t: number, x) => t + (num(pick(x, ["stock", "quantity", "available", "inventory", "total"])) ?? 0), 0);
      return Math.round(total);
    }
  }
  return null;
}

function statusOf(raw: Obj): string | null {
  const s = pick(raw, F.status);
  if (typeof s === "boolean") return s ? "Activo" : "Inactivo";
  const active = pick(raw, ["isActive", "active", "enabled", "published"]);
  if (s === undefined && typeof active === "boolean") return active ? "Activo" : "Inactivo";
  const t = str(s);
  if (!t) return null;
  const map: Record<string, string> = { active: "Activo", inactive: "Inactivo", draft: "Borrador", pending: "Pendiente", archived: "Archivado", rejected: "Rechazado" };
  return map[t.toLowerCase()] ?? t;
}

export function normalizeProduct(raw: unknown): NormalizedProduct | null {
  if (!isObj(raw)) return null;
  const id = str(pick(raw, F.id));
  const name = str(pick(raw, F.name));
  if (!id || !name) return null;
  const created = str(pick(raw, F.created));
  return {
    external_id: id,
    code: str(pick(raw, F.code)),
    name,
    sku: str(pick(raw, F.sku)),
    status: statusOf(raw),
    price: num(pick(raw, F.price)),
    suggested_price: num(pick(raw, F.suggested)),
    stock: stockOf(raw),
    image_url: str(pick(raw, F.image)),
    created_at_platform: created && !Number.isNaN(Date.parse(created)) ? new Date(created).toISOString() : null,
    raw,
  };
}

/** ¿Parece un producto? (id + nombre + algo de precio/sku/inventario) */
function looksLikeProduct(o: Obj): boolean {
  if (pick(o, F.id) === undefined || pick(o, F.name) === undefined) return false;
  // descartar órdenes u otras entidades
  if (pick(o, ["orderInfo", "customer", "productSnapshots"]) !== undefined) return false;
  return [F.sku, F.price, F.stock, F.image].some((f) => pick(o, f) !== undefined);
}

export function extractProducts(payload: unknown): NormalizedProduct[] {
  const found = new Map<string, NormalizedProduct>();
  const walk = (node: unknown, depth: number) => {
    if (depth > 5 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, depth + 1);
      return;
    }
    if (looksLikeProduct(node as Obj)) {
      const p = normalizeProduct(node);
      if (p) {
        found.set(p.external_id, p);
        return;
      }
    }
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(payload, 0);
  return [...found.values()];
}
