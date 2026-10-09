import { NextResponse, type NextRequest } from "next/server";
import { authorizeRoute } from "@/lib/auth";
import { listAccounts } from "@/lib/accounts";
import { orderExportRows } from "@/lib/order-export";
import { can } from "@/lib/permissions";
import { listAllOrders, parseFilters } from "@/lib/queries";
import { getScope } from "@/lib/scope";
import { buildXlsx, XLSX_TYPE } from "@/lib/xlsx";

// Exporta las órdenes con los mismos filtros de Órdenes y la cuenta activa, en Excel (.xlsx,
// `format=xlsx`) o CSV. Una fila por producto, para preparar despachos.

export const maxDuration = 60;

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest) {
  const user = await authorizeRoute("orders", "export");
  if (user instanceof Response) return user;
  // la columna Liquidada es dato de liquidación: solo con permiso de Dinero
  const paidCol = can(user, "money");

  // los filtros que se repiten (varias tiendas) llegan como lista
  const sp: Record<string, string | string[]> = {};
  for (const [k, v] of req.nextUrl.searchParams) {
    const prev = sp[k];
    sp[k] = prev === undefined ? v : [...(Array.isArray(prev) ? prev : [prev]), v];
  }
  const scope = await getScope(await listAccounts());
  const filters = { ...parseFilters(sp), account: scope.account };
  const orders = await listAllOrders(filters);
  const { columns, rows } = orderExportRows(orders, { paidCol });
  const stamp = new Date().toISOString().slice(0, 10);

  if (req.nextUrl.searchParams.get("format") === "xlsx") {
    const book = buildXlsx([{ name: "Órdenes", columns, rows }]);
    return new NextResponse(Buffer.from(book), {
      headers: {
        "content-type": XLSX_TYPE,
        "content-disposition": `attachment; filename="ordenes-miranova-${stamp}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  }

  const lines = [columns.map((c) => esc(c.header)).join(","), ...rows.map((r) => r.map(esc).join(","))];
  // BOM para que Excel respete los acentos
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="ordenes-miranova-${stamp}.csv"`,
    },
  });
}
