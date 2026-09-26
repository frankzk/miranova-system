import type { NormalizedItem, NormalizedOrder } from "../normalize.ts";

// Formato de las órdenes de Dropi (GET /api/orders/myorders/v2). Campos usados:
// {
//   id, status, created_at, name, surname, phone, client_email, dir, city, state, notes,
//   total_order, shipping_amount, shipping_company, shipping_guide, rate_type ("CON RECAUDO"),
//   shop_order_number, user: { name, surname } (dropshipper),
//   orderdetails: [{ quantity, price, supplier_price, product: { name, sku, gallery: [{ urlS3 }] }, variation }]
// }
// El objeto completo queda en `raw`: si algún campo sale vacío, se ajusta aquí y
// se usa "Volver a leer órdenes".

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const o = (v: unknown): Obj => (isObj(v) ? v : {});
const s = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (isObj(v)) return s(v.name ?? v.nombre ?? v.label);
  const t = String(v).trim();
  return t === "" ? null : t;
};
const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

export function isDropiOrder(raw: unknown): raw is Obj {
  return isObj(raw) && raw.id !== undefined && (Array.isArray(raw.orderdetails) || "total_order" in raw || "shipping_guide" in raw);
}

/**
 * Traduce el estado de Dropi al código de grupo que usa el panel
 * (el mismo vocabulario de Drop): por despachar, en tránsito, entregada...
 */
export function dropiStatusCode(status: string | null): string | null {
  if (!status) return null;
  const t = status.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/_/g, " ");
  if (/CANCEL|RECHAZ|ANULAD/.test(t)) return "cancelled";
  if (/NO ENTREG|DEVOLUCION|DEVUELT/.test(t)) return "7";
  if (/ENTREGAD/.test(t)) return "4";
  if (/NOVEDAD|INCIDEN|PROBLEM|REVISION|INDEMNIZ/.test(t)) return "6";
  if (/TRANSITO|RUTA|REPARTO|RECOLECT|DESPACHAD|EN BODEGA|CENTRO|REEXPED/.test(t)) return "2";
  if (/PENDIENTE|GUIA|PREPARAD|CONFIRM/.test(t)) return "pending";
  return null;
}

/** "GUIA_GENERADA" → "Guía generada" */
function statusLabel(status: string | null): string | null {
  if (!status) return null;
  const t = status.replace(/_/g, " ").toLowerCase().replace(/\bguia\b/g, "guía");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Fecha de Dropi a ISO. Sin zona horaria, se interpreta en la del país de la cuenta. */
function toIso(v: unknown, tz: string): string | null {
  const t = s(v);
  if (!t) return null;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const [, y, mo, d, h, mi, se = "0"] = m;
    const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]),
    );
    const asTz = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return new Date(guess - (asTz - guess)).toISOString();
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function image(product: Obj): string | null {
  const gallery = Array.isArray(product.gallery) ? product.gallery.filter(isObj) : [];
  const url = s(gallery[0]?.urlS3) ?? s(gallery[0]?.url) ?? s(product.image);
  return url && /^https?:\/\//.test(url) ? url : null;
}

export function normalizeDropiOrder(
  raw: Obj,
  opts: { currency?: string; timezone?: string } = {},
): NormalizedOrder | null {
  const external_id = s(raw.id);
  if (!external_id) return null;

  const details = Array.isArray(raw.orderdetails) ? raw.orderdetails.filter(isObj) : [];
  const items: NormalizedItem[] = details.map((d) => {
    const product = o(d.product);
    const quantity = Math.max(1, Math.round(n(d.quantity) ?? 1));
    const supplier = n(d.supplier_price);
    return {
      sku: s(o(d.variation).sku) ?? s(product.sku),
      product_name: [s(product.name) ?? "Producto", s(o(d.variation).name)].filter(Boolean).join(" — "),
      quantity,
      price: n(d.price),
      vendor_price: supplier === null ? null : supplier * quantity,
      image_url: image(product),
    };
  });

  const status = s(raw.status);
  const user = o(raw.user);
  const rate = s(raw.rate_type);
  const vendorTotal = items.some((i) => i.vendor_price != null)
    ? items.reduce((t, i) => t + (i.vendor_price ?? 0), 0)
    : null;

  return {
    external_id,
    shopify_order: s(raw.shop_order_number) ?? s(raw.shop_order_id),
    status: statusLabel(status),
    status_code: dropiStatusCode(status),
    dropshipper: [s(user.name), s(user.surname)].filter(Boolean).join(" ") || s(raw.store_name),
    customer_name: [s(raw.name), s(raw.surname)].filter(Boolean).join(" ") || null,
    customer_email: s(raw.client_email) ?? s(raw.email),
    customer_phone: s(raw.phone),
    department: s(raw.state) ?? s(raw.department),
    city: s(raw.city),
    address: s(raw.dir) ?? s(raw.address),
    reference_point: null,
    notes: s(raw.notes),
    carrier: s(raw.shipping_company) ?? s(o(raw.distribution_company).name),
    tracking_number: s(raw.shipping_guide),
    label_url: s(raw.sticker) && /^https?:\/\//.test(s(raw.sticker)!) ? s(raw.sticker) : null,
    total: n(raw.total_order) ?? (items.length ? items.reduce((t, i) => t + (i.price ?? 0) * i.quantity, 0) : null),
    shipping_cost: n(raw.shipping_amount),
    vendor_amount: vendorTotal,
    cod: rate ? /CON RECAUDO/i.test(rate) : null,
    currency: opts.currency ?? null,
    ordered_at: toIso(raw.created_at, opts.timezone ?? "America/Guatemala"),
    raw,
    items,
  };
}
