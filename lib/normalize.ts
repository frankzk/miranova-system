// Convierte las respuestas JSON de la API de Drop en pedidos normalizados.
//
// No conocemos el esquema exacto de la API interna de Drop, así que buscamos
// cada campo entre varios nombres candidatos (español/inglés, camelCase/snake_case,
// anidados). El objeto original siempre se guarda en `raw`, así que si algún
// campo sale vacío basta con añadir su nombre aquí y re-procesar.

import { isDropiOrder, normalizeDropiOrder } from "./connectors/dropi-map.ts";
import { isSoydropOrder, normalizeSoydropOrder } from "./connectors/soydrop-map.ts";

export type NormalizedItem = {
  sku: string | null;
  product_name: string;
  quantity: number;
  price: number | null;
  /** Lo que recibe el proveedor por esta línea (si la plataforma lo informa). */
  vendor_price?: number | null;
  image_url: string | null;
  /** ID del producto en la plataforma (estable aunque cambie el nombre o el SKU). */
  product_external_id?: string | null;
};

export type NormalizedOrder = {
  external_id: string;
  shopify_order: string | null;
  status: string | null;
  dropshipper: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  department: string | null;
  city: string | null;
  address: string | null;
  reference_point: string | null;
  notes: string | null;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url?: string | null;
  label_url?: string | null;
  status_code?: string | null;
  total: number | null;
  shipping_cost?: number | null;
  vendor_amount?: number | null; // lo que cobra el proveedor por la orden
  vendor_net?: number | null; // ganancia neta estimada del proveedor
  cod?: boolean | null; // pago contra entrega
  paid?: boolean | null; // liquidado al proveedor
  currency: string | null;
  ordered_at: string | null;
  raw: unknown;
  items: NormalizedItem[];
};

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Normaliza un nombre de clave: minúsculas, sin acentos ni separadores. */
const keyNorm = (k: string) =>
  k
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();

/** Obtiene un valor por ruta "a.b.c" comparando claves de forma tolerante. */
function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (!isObj(cur)) return undefined;
    const want = keyNorm(part);
    const key = Object.keys(cur).find((k) => keyNorm(k) === want);
    if (key === undefined) return undefined;
    cur = cur[key];
  }
  return cur;
}

function pick(obj: unknown, paths: string[]): unknown {
  for (const p of paths) {
    const v = getPath(obj, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    return s === "" ? null : s;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (isObj(v)) {
    // objetos tipo { name: "Forza" } o { label: "Pendiente" }
    return str(pick(v, ["name", "nombre", "label", "title", "value", "description"]));
  }
  return null;
}

export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    // "L1,780.00", "L 602.36", "1.780,00"
    let s = v.replace(/[^\d.,-]/g, "");
    if (s === "" || s === "-") return null;
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  if (isObj(v)) return num(pick(v, ["amount", "value", "monto"]));
  return null;
}

export type NormalizeOptions = { currency?: string; timezone?: string; geo?: Record<string, string> | null };

/** Convierte una fecha/hora "de reloj" en una zona horaria IANA a ISO UTC. */
export function zonedToIso(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): string {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(guess)).map((p) => [p.type, p.value]),
  );
  const asTz = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return new Date(guess - (asTz - guess)).toISOString();
}

function date(v: unknown, tz: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") {
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === "string") {
    // "25/09/2026 15:54" (hora local del país de la cuenta)
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
      const [, dd, mm, yyyy, hh = "0", mi = "0", ss = "0"] = m;
      return zonedToIso(+yyyy, +mm, +dd, +hh, +mi, +ss, tz);
    }
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

const F = {
  id: [
    "dropOrderId", "drop_order_id", "orderNumber", "order_number", "numeroOrden",
    "orden", "code", "codigo", "number", "orderId", "order_id", "id", "_id", "uuid",
  ],
  shopify: [
    "shopifyOrder", "shopify_order", "shopifyOrderNumber", "shopify_order_number",
    "shopifyOrderName", "shopifyOrderId", "shopify_order_id", "shopify.name", "shopify.orderNumber",
    "externalOrder", "external_order_number",
  ],
  status: [
    "status", "estado", "state", "orderStatus", "order_status", "fulfillmentStatus",
    "fulfillment_status", "dispatchStatus", "shippingStatus",
  ],
  dropshipper: [
    "dropshipper.name", "dropshipper.storeName", "dropshipper.businessName", "dropshipper",
    "dropshipperName", "dropshipper_name", "store.name", "storeName", "store_name",
    "seller.name", "sellerName", "reseller.name", "tienda", "store",
  ],
  customer: ["customer", "cliente", "client", "buyer", "shippingAddress", "shipping_address", "recipient", "destinatario"],
  name: ["fullName", "full_name", "nombreCompleto", "nombre_completo", "name", "nombre"],
  firstName: ["firstName", "first_name", "nombres"],
  lastName: ["lastName", "last_name", "apellidos"],
  email: ["email", "correo", "correoElectronico", "correo_electronico", "mail"],
  phone: ["phone", "telefono", "phoneNumber", "phone_number", "celular", "mobile", "whatsapp"],
  address: ["shippingAddress", "shipping_address", "address", "direccion", "destination", "destino"],
  department: ["department", "departamento", "province", "provincia", "region"],
  city: ["city", "ciudad", "municipio", "municipality", "town"],
  street: ["address1", "address", "direccion", "street", "calle", "line1", "fullAddress", "full_address"],
  reference: ["reference", "referencia", "puntoReferencia", "punto_referencia", "puntoDeReferencia", "referencePoint", "reference_point", "landmark", "address2"],
  notes: ["indications", "indicaciones", "indicacionesOpcional", "notes", "note", "notas", "observaciones", "comments", "instructions"],
  carrier: [
    "carrier.name", "carrier", "paquetera", "courier.name", "courier", "shippingCompany",
    "shipping_company", "logisticCompany", "logistic.name", "transportadora", "shipping.carrier",
  ],
  tracking: ["trackingNumber", "tracking_number", "guia", "numeroGuia", "guide", "trackingCode", "tracking", "waybill"],
  total: ["total", "totalAmount", "total_amount", "totalPrice", "total_price", "amount", "monto", "grandTotal", "valor"],
  currency: ["currency", "moneda", "currencyCode", "currency_code"],
  date: ["createdAt", "created_at", "creationDate", "fechaCreacion", "fecha_creacion", "creacion", "date", "fecha", "orderDate", "order_date"],
  items: ["items", "products", "productos", "lineItems", "line_items", "orderItems", "order_items", "details", "detalle", "detalles", "orderDetails"],
  itemName: ["product.name", "product.title", "productName", "product_name", "name", "title", "nombre", "producto", "descripcion", "product"],
  itemQty: ["quantity", "qty", "cantidad", "units", "count"],
  itemPrice: ["price", "precio", "unitPrice", "unit_price", "product.price", "amount", "subtotal", "total"],
  itemSku: ["sku", "product.sku", "variant.sku", "code", "codigo", "productId", "product_id"],
  itemImage: ["image", "imageUrl", "image_url", "imagen", "product.image", "product.imageUrl", "product.images.0", "images.0", "thumbnail", "photo", "picture"],
};

function normalizeItem(raw: unknown): NormalizedItem | null {
  if (!isObj(raw)) return null;
  const name = str(pick(raw, F.itemName));
  if (!name) return null;
  const img = pick(raw, F.itemImage);
  return {
    sku: str(pick(raw, F.itemSku)),
    product_name: name,
    quantity: Math.max(1, Math.round(num(pick(raw, F.itemQty)) ?? 1)),
    price: num(pick(raw, F.itemPrice)),
    image_url: str(isObj(img) ? pick(img, ["url", "src"]) : img),
  };
}

/** Normaliza un objeto que parece un pedido de Drop. Devuelve null si no lo es. */
export function normalizeOrder(raw: unknown, opts: NormalizeOptions = {}): NormalizedOrder | null {
  if (isSoydropOrder(raw)) return normalizeSoydropOrder(raw, opts);
  if (isDropiOrder(raw)) return normalizeDropiOrder(raw, opts);
  if (!isObj(raw)) return null;
  const idRaw = str(pick(raw, F.id));
  if (!idRaw) return null;
  const external_id = idRaw.replace(/^#/, "");

  const customerObj = pick(raw, F.customer);
  const c = isObj(customerObj) ? customerObj : raw;
  const addrObj = pick(raw, F.address);
  const a = isObj(addrObj) ? addrObj : isObj(pick(c, ["address", "direccion"])) ? (pick(c, ["address", "direccion"]) as Obj) : c;

  // nombre: primero en el cliente, luego campos sueltos en el pedido
  let customer_name =
    (isObj(customerObj) ? str(pick(c, F.name)) : null) ??
    str(pick(raw, ["customerName", "customer_name", "clientName", "client_name", "nombreCliente", "nombre_cliente"]));
  if (!customer_name) {
    const fn = str(pick(c, F.firstName)) ?? str(pick(raw, F.firstName));
    const ln = str(pick(c, F.lastName)) ?? str(pick(raw, F.lastName));
    customer_name = [fn, ln].filter(Boolean).join(" ") || null;
  }
  if (typeof customerObj === "string") customer_name ??= str(customerObj);

  const itemsRaw = pick(raw, F.items);
  const items = Array.isArray(itemsRaw)
    ? itemsRaw.map(normalizeItem).filter((x): x is NormalizedItem => x !== null)
    : [];

  const addrStr = typeof addrObj === "string" ? str(addrObj) : null;

  return {
    external_id,
    shopify_order: str(pick(raw, F.shopify)),
    status: str(pick(raw, F.status)),
    dropshipper: str(pick(raw, F.dropshipper)),
    customer_name,
    customer_email: str(pick(c, F.email)) ?? str(pick(raw, F.email)),
    customer_phone: str(pick(c, F.phone)) ?? str(pick(a, F.phone)) ?? str(pick(raw, F.phone)),
    department:
      str(pick(a, F.department)) ??
      str(pick(c, F.department)) ??
      // "state" solo cuenta como departamento dentro de un objeto de dirección/cliente
      (a !== raw ? str(pick(a, ["state"])) : null) ??
      (c !== raw ? str(pick(c, ["state"])) : null),
    city: str(pick(a, F.city)) ?? str(pick(c, F.city)) ?? str(pick(raw, F.city)),
    address: addrStr ?? str(pick(a, F.street)) ?? str(pick(c, F.street)),
    reference_point: str(pick(a, F.reference)) ?? str(pick(c, F.reference)) ?? str(pick(raw, F.reference)),
    notes: str(pick(raw, F.notes)) ?? str(pick(a, F.notes)),
    carrier: str(pick(raw, F.carrier)),
    tracking_number: str(pick(raw, F.tracking)),
    total:
      num(pick(raw, F.total)) ??
      (items.length ? items.reduce((s, i) => s + (i.price ?? 0) * i.quantity, 0) : null),
    currency: str(pick(raw, F.currency)) ?? opts.currency ?? "HNL",
    ordered_at: date(pick(raw, F.date), opts.timezone ?? "America/Tegucigalpa"),
    raw,
    items,
  };
}

/** ¿Este objeto parece un pedido? (tiene id + algo de cliente/total/items) */
function looksLikeOrder(o: Obj): boolean {
  if (pick(o, F.id) === undefined) return false;
  let signals = 0;
  if (pick(o, F.customer) !== undefined || pick(o, ["customerName", "customer_name", "clientName"]) !== undefined) signals++;
  if (pick(o, F.total) !== undefined) signals++;
  if (Array.isArray(pick(o, F.items))) signals++;
  if (pick(o, F.carrier) !== undefined || pick(o, F.dropshipper) !== undefined) signals++;
  if (pick(o, F.status) !== undefined) signals++;
  return signals >= 2;
}

/**
 * Recorre cualquier respuesta JSON (lista paginada, { data: [...] }, detalle
 * de un pedido, etc.) y devuelve todos los pedidos encontrados.
 */
export function extractOrders(payload: unknown, opts: NormalizeOptions = {}): NormalizedOrder[] {
  const found = new Map<string, NormalizedOrder>();
  const walk = (node: unknown, depth: number) => {
    if (depth > 6 || (!isObj(node) && !Array.isArray(node))) return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, depth + 1);
      return;
    }
    if (isSoydropOrder(node) || isDropiOrder(node) || looksLikeOrder(node)) {
      const o = normalizeOrder(node, opts);
      if (o) {
        const prev = found.get(o.external_id);
        // si el mismo pedido aparece dos veces, quedarse con la versión más completa
        if (!prev || JSON.stringify(o.raw).length > JSON.stringify(prev.raw).length) {
          found.set(o.external_id, o);
        }
        return;
      }
    }
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(payload, 0);
  return [...found.values()];
}
