import { NextResponse, type NextRequest } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { listAccounts } from "@/lib/accounts";
import { applyProductFilters, parseProductFilters, SALES_DAYS, soldOf } from "@/lib/product-filters";
import { listProducts, productSales } from "@/lib/queries";
import { getScope } from "@/lib/scope";

// Exporta el catálogo de productos (cuenta activa) a CSV, con los mismos filtros y orden de la página.

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest) {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const scope = await getScope(await listAccounts());
  const [products, sales] = await Promise.all([listProducts(scope.account), productSales(scope.account, SALES_DAYS)]);
  const rows = applyProductFilters(products, parseProductFilters(Object.fromEntries(req.nextUrl.searchParams)), sales);

  const header = ["Cuenta", "Código", "Producto", "SKU", "Estado", "Precio", "Precio sugerido", "Inventario", "Variantes", "Vendido 30 días", "Moneda", "Creado"];
  const lines = [header.map(esc).join(",")];
  for (const p of rows) {
    const sold = soldOf(p, sales);
    lines.push(
      [p.accounts?.name, p.code, p.name, p.sku, p.status, p.price, p.suggested_price, p.stock, p.variants_count, sold?.units ?? 0, p.currency, p.created_at_platform?.slice(0, 10)]
        .map(esc)
        .join(","),
    );
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="productos-miranova-${stamp}.csv"`,
    },
  });
}
