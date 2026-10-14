import { NextResponse, type NextRequest } from "next/server";
import { authorizeRoute } from "@/lib/auth";
import { listAccounts } from "@/lib/accounts";
import { applyProductFilters, parseProductFilters, SALES_DAYS, soldOf } from "@/lib/product-filters";
import { mediaKey } from "@/lib/media-rules";
import { mediaByKey } from "@/lib/product-media";
import { listProducts, productSales } from "@/lib/queries";
import { getScope } from "@/lib/scope";
import { buildXlsx, XLSX_TYPE, type Cell } from "@/lib/xlsx";

// Exporta el catálogo de productos (cuenta activa) en Excel (.xlsx, `format=xlsx`) o CSV, con los
// mismos filtros y orden de la página.

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// en Excel los montos y cantidades van como número, para poder sumar y ordenar
const num = (v: unknown): Cell => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

const COLUMNS = [
  { header: "Cuenta", width: 18 },
  { header: "Código", width: 12 },
  { header: "Producto", width: 44 },
  { header: "SKU", width: 16 },
  { header: "Estado", width: 12 },
  { header: "Precio", width: 11 },
  { header: "Precio sugerido", width: 15 },
  { header: "Inventario", width: 11 },
  { header: "Variantes", width: 10 },
  { header: "Vendido 30 días", width: 15 },
  { header: "Fotos reales", width: 12 },
  { header: "Moneda", width: 9 },
  { header: "Creado", width: 12 },
];

export async function GET(req: NextRequest) {
  const user = await authorizeRoute("products", "export");
  if (user instanceof Response) return user;
  const scope = await getScope(await listAccounts());
  const [products, sales, media] = await Promise.all([listProducts(scope.account), productSales(scope.account, SALES_DAYS), mediaByKey()]);
  const photos = (p: (typeof products)[number]) => media.get(mediaKey(p))?.length ?? 0;
  const list = applyProductFilters(products, parseProductFilters(Object.fromEntries(req.nextUrl.searchParams)), sales, (p) => photos(p) > 0);

  const rows: Cell[][] = list.map((p) => [
    p.accounts?.name,
    p.code,
    p.name,
    p.sku,
    p.status,
    num(p.price),
    num(p.suggested_price),
    num(p.stock),
    num(p.variants_count),
    soldOf(p, sales)?.units ?? 0,
    photos(p),
    p.currency,
    p.created_at_platform?.slice(0, 10),
  ]);
  const stamp = new Date().toISOString().slice(0, 10);

  if (req.nextUrl.searchParams.get("format") === "xlsx") {
    const book = buildXlsx([{ name: "Productos", columns: COLUMNS, rows }]);
    return new NextResponse(Buffer.from(book), {
      headers: {
        "content-type": XLSX_TYPE,
        "content-disposition": `attachment; filename="productos-miranova-${stamp}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  }

  const lines = [COLUMNS.map((c) => esc(c.header)).join(","), ...rows.map((r) => r.map(esc).join(","))];
  // BOM para que Excel respete los acentos
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="productos-miranova-${stamp}.csv"`,
    },
  });
}
