import type { NormalizedItem, NormalizedOrder } from "../normalize.ts";

// Formato exacto de las órdenes de api.soydrop.com (GET /orders). Ejemplo abreviado:
// {
//   id, seller: { name }, vendor: { name },
//   customer: { name, lastName, email, phone, phoneAreaCode },
//   address: { street, referencePoint, cityId, stateId },
//   orderInfo: { orderNumber, status, createdAt, note, instructions, statusTimeline: [{ label, occurredAt }] },
//   shipping: { shipmentNumber, trackingUrl, labelUrl, shippingCost, shipmentStatusDescription },
//   courierSnapshot: { name }, shopify: { orderNumber },
//   payment: { cod, paid, paidAt, codAmount, vendorCodAmount },
//   vendorEstimatedNetProfit,
//   productSnapshots: [{ sku, productName, quantity, sellerPrice, vendorPrice, productImage, variantName }]
// }

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const s = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
};
const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const o = (v: unknown): Obj => (isObj(v) ? v : {});

/** Etiquetas de los estados de orden de Drop que no son de envío. */
const STATUS_LABELS: Record<string, string> = {
  registered: "Pendiente",
  pending: "Pendiente",
  pending_correction: "Verificar",
  fulfilled: "Creado en sistema",
  cancelled: "Orden cancelada",
  rejected: "Orden rechazada",
};

export function isSoydropOrder(raw: unknown): raw is Obj {
  return isObj(raw) && isObj(raw.orderInfo) && Array.isArray(raw.productSnapshots);
}

export function statusLabel(raw: Obj): string | null {
  const info = o(raw.orderInfo);
  const code = s(info.status);
  const shipDesc = s(o(raw.shipping).shipmentStatusDescription);
  // estados numéricos = estado del envío (Recolectado, En ruta, Entregado, ...)
  if (code && /^\d+$/.test(code) && shipDesc) return shipDesc;
  if (code && STATUS_LABELS[code]) return STATUS_LABELS[code];
  const timeline = Array.isArray(info.statusTimeline) ? info.statusTimeline.filter(isObj) : [];
  const last = [...timeline].sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt))).pop();
  return s(last?.label) ?? shipDesc ?? code;
}

export function normalizeSoydropOrder(
  raw: Obj,
  opts: { currency?: string; geo?: Record<string, string> | null } = {},
): NormalizedOrder | null {
  const info = o(raw.orderInfo);
  const external_id = s(info.orderNumber) ?? s(raw.id);
  if (!external_id) return null;

  const customer = o(raw.customer);
  const address = o(raw.address);
  const shipping = o(raw.shipping);
  const payment = o(raw.payment);
  const geo = opts.geo ?? {};

  const phone = s(customer.phone);
  const area = s(customer.phoneAreaCode)?.replace(/^\+/, "");
  const notes = [s(info.instructions), s(info.note)].filter(Boolean).join(" · ") || null;

  const items: NormalizedItem[] = (raw.productSnapshots as unknown[]).filter(isObj).map((p) => ({
    sku: s(p.sku),
    product_name: [s(p.productName) ?? "Producto", s(p.variantName)].filter(Boolean).join(" — "),
    quantity: Math.max(1, Math.round(n(p.quantity) ?? 1)),
    price: n(p.sellerPrice),
    vendor_price: n(p.vendorPrice),
    image_url: s(p.productImage),
  }));

  return {
    external_id,
    shopify_order: s(o(raw.shopify).orderNumber),
    status: statusLabel(raw),
    status_code: s(info.status),
    dropshipper: s(o(raw.seller).name),
    customer_name: [s(customer.name), s(customer.lastName)].filter(Boolean).join(" ") || null,
    customer_email: s(customer.email),
    customer_phone: phone ? (area && !phone.startsWith(area) ? `${area} ${phone}` : phone) : null,
    department: geo[String(address.stateId)] ?? null,
    city: geo[String(address.cityId)] ?? null,
    address: s(address.street),
    reference_point: s(address.referencePoint),
    notes,
    carrier: s(o(raw.courierSnapshot).name),
    tracking_number: s(shipping.shipmentNumber),
    tracking_url: s(shipping.trackingUrl),
    label_url: s(shipping.labelUrl),
    total: n(payment.codAmount) ?? items.reduce((t, i) => t + (i.price ?? 0), 0),
    shipping_cost: n(shipping.shippingCost) ?? n(raw.estimatedShippingCost),
    vendor_amount: n(payment.vendorCodAmount),
    vendor_net: n(raw.vendorEstimatedNetProfit),
    cod: typeof payment.cod === "boolean" ? payment.cod : null,
    paid: typeof payment.paid === "boolean" ? payment.paid : null,
    currency: opts.currency ?? "HNL",
    ordered_at: s(info.createdAt),
    raw,
    items,
  };
}
