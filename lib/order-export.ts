// Filas de la exportación de Órdenes (Excel y CSV): una por producto, para preparar despachos.
// Los montos y cantidades van como números (Excel suma y filtra sin convertir) y la fecha como
// "AAAA-MM-DD HH:MM" en la hora de la cuenta, que se ordena bien aun siendo texto.

import type { Order } from "./queries";
import type { Cell } from "./xlsx";

/** "2026-10-07 06:24" en la zona de la cuenta. */
export function sortableDate(iso: string | null | undefined, tz = "America/Tegucigalpa"): string | null {
  if (!iso) return null;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

type ExportOrder = Pick<Order,
  | "external_id" | "shopify_order" | "ordered_at" | "status" | "dropshipper" | "customer_name" | "customer_phone"
  | "customer_email" | "department" | "city" | "address" | "reference_point" | "notes" | "carrier" | "tracking_number"
  | "tracking_url" | "cod" | "total" | "vendor_amount" | "paid" | "currency" | "accounts" | "order_items">;

export function orderExportRows(orders: ExportOrder[], opts: { paidCol: boolean }) {
  const columns = [
    { header: "Cuenta", width: 16 }, { header: "Orden", width: 16 }, { header: "Orden Shopify", width: 13 }, { header: "Fecha", width: 17 },
    { header: "Estado", width: 18 }, { header: "Dropshipper", width: 24 }, { header: "Cliente", width: 24 }, { header: "Teléfono", width: 14 },
    { header: "Correo", width: 24 }, { header: "Departamento", width: 16 }, { header: "Ciudad", width: 18 }, { header: "Dirección", width: 40 },
    { header: "Punto de referencia", width: 28 }, { header: "Indicaciones", width: 28 }, { header: "Paquetera", width: 14 }, { header: "Guía", width: 16 },
    { header: "Tracking", width: 30 }, { header: "Pago", width: 14 }, { header: "Producto", width: 40 }, { header: "SKU", width: 16 },
    { header: "Cantidad", width: 9 }, { header: "Precio", width: 11 }, { header: "Precio proveedor", width: 12 }, { header: "Total orden", width: 11 },
    { header: "Te toca", width: 11 },
    ...(opts.paidCol ? [{ header: "Liquidada", width: 10 }] : []),
    { header: "Moneda", width: 8 },
  ];
  const rows: Cell[][] = [];
  for (const o of orders) {
    const base: Cell[] = [
      o.accounts?.name, o.external_id, o.shopify_order, sortableDate(o.ordered_at, o.accounts?.timezone), o.status, o.dropshipper,
      o.customer_name, o.customer_phone, o.customer_email, o.department, o.city, o.address, o.reference_point, o.notes,
      o.carrier, o.tracking_number, o.tracking_url, o.cod === null ? null : o.cod ? "Contra entrega" : "Prepagado",
    ];
    const items = o.order_items.length ? o.order_items : [null];
    for (const it of items) {
      rows.push([
        ...base, it?.product_name, it?.sku, num(it?.quantity), num(it?.price), num(it?.vendor_price), num(o.total), num(o.vendor_amount),
        ...(opts.paidCol ? [o.paid === null ? null : o.paid ? "Sí" : "No"] : []), o.currency,
      ]);
    }
  }
  return { columns, rows };
}
