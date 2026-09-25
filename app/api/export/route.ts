import { NextResponse, type NextRequest } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { listOrders, parseFilters } from "@/lib/queries";
import { fmtDate } from "@/lib/format";

// Exporta a CSV (abre directo en Excel) con los mismos filtros del panel.
// Una fila por producto, para preparar despachos.

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest) {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const filters = parseFilters(Object.fromEntries(req.nextUrl.searchParams));
  const { orders } = await listOrders(filters, { all: true });

  const header = [
    "Cuenta", "Orden", "Orden Shopify", "Fecha", "Estado", "Dropshipper", "Cliente", "Teléfono", "Correo",
    "Departamento", "Ciudad", "Dirección", "Punto de referencia", "Indicaciones", "Paquetera", "Guía",
    "Tracking", "Pago", "Producto", "SKU", "Cantidad", "Precio", "Precio proveedor", "Total orden", "Tú recibes", "Moneda",
  ];
  const lines = [header.map(esc).join(",")];

  for (const o of orders) {
    const base = [
      o.accounts?.name, o.external_id, o.shopify_order, fmtDate(o.ordered_at), o.status, o.dropshipper, o.customer_name,
      o.customer_phone, o.customer_email, o.department, o.city, o.address, o.reference_point, o.notes,
      o.carrier, o.tracking_number, o.tracking_url, o.cod === null ? "" : o.cod ? "Contra entrega" : "Prepagado",
    ];
    const items = o.order_items.length ? o.order_items : [null];
    for (const it of items) {
      lines.push(
        [...base, it?.product_name, it?.sku, it?.quantity, it?.price, it?.vendor_price, o.total, o.vendor_amount, o.currency].map(esc).join(","),
      );
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  // BOM para que Excel respete los acentos
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="pedidos-drop-${stamp}.csv"`,
    },
  });
}
