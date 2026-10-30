import { NextResponse, type NextRequest } from "next/server";
import { listAccounts } from "@/lib/accounts";
import { authorizeRoute } from "@/lib/auth";
import { storeProfiles } from "@/lib/contacts";
import { compareRows, MOVE_LABEL, pctChange, periodStartIso, productMove, storeHabits, trendInfo } from "@/lib/store-compare";
import { MATRIX_DAYS, storeProductCompare } from "@/lib/store-product-matrix";
import { getScope } from "@/lib/scope";
import { buildXlsx, XLSX_TYPE, type Cell } from "@/lib/xlsx";

// Tienda × producto en Excel: todas las tiendas y productos de la cuenta elegida (o de todas) en el
// período (7, 30 o 90 días) y en el anterior del mismo largo, con el estado de cada tienda, sus
// hábitos y qué ofrecerle. Respaldo de la vista del panel, sin sus filtros.

const pct = (c: number | null) => (c === null ? null : Math.round(c * 1000) / 10);
const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

export async function GET(req: NextRequest) {
  const user = await authorizeRoute("products", "export");
  if (user instanceof Response) return user;
  const raw = Number(req.nextUrl.searchParams.get("days"));
  const days = (MATRIX_DAYS as readonly number[]).includes(raw) ? raw : 30;
  const accounts = await listAccounts();
  const scope = await getScope(accounts);
  const [data, profiles] = await Promise.all([storeProductCompare(scope.account, days), storeProfiles().catch(() => [])]);
  const firstAt = new Map(profiles.map((p) => [`${p.account_id}|${p.store_id}`, p.first_at]));
  const filter = { periodStart: periodStartIso(days), firstAt };
  const accountName = new Map(data.accounts.map((a) => [a.account_id, a.account_name]));
  const currency = new Map(data.accounts.map((a) => [a.account_id, a.currency]));
  const productName = new Map(data.products.map((p) => [`${p.account_id}|${p.product_key}`, p.name]));

  const stores: Cell[][] = [];
  const offers: Cell[][] = [];
  for (const a of data.accounts) {
    for (const r of compareRows(data, a.account_id, filter).rows) {
      const s = r.store;
      const h = storeHabits(data, a.account_id, s.store_id, filter);
      stores.push([
        a.account_name, s.name, trendInfo(r.trend).label, s.orders, s.orders_prev, pct(r.change), r.delta, s.skus, s.skus_prev,
        s.active_days, r2(s.orders / days), h?.unitsPerOrder === null || !h ? null : r2(h.unitsPerOrder), h?.ticket === null || !h ? null : r2(h.ticket),
        currency.get(a.account_id) ?? null, day(s.last_at), h?.dropped.map((d) => d.name).join(", ") || null,
        s.fu_at, s.fu_at ? s.fu_before : null, s.fu_at ? s.fu_after : null,
      ]);
      for (const o of h?.offer ?? []) offers.push([a.account_name, s.name, trendInfo(r.trend).label, o.name, o.reason]);
    }
  }
  const storeName = new Map(data.stores.map((s) => [`${s.account_id}|${s.store_id}`, s.name]));
  const cells: Cell[][] = data.cells
    .filter((c) => c.n + c.p > 0)
    .map((c) => [
      accountName.get(c.account_id) ?? null, storeName.get(`${c.account_id}|${c.store_id}`) ?? c.store_id,
      productName.get(`${c.account_id}|${c.product_key}`) ?? c.product_key, c.n, c.p, c.n - c.p, pct(pctChange(c.n, c.p)),
      MOVE_LABEL[productMove(c.n, c.p)], day(c.last_at),
    ])
    .sort((x, y) => String(x[0]).localeCompare(String(y[0])) || String(x[1]).localeCompare(String(y[1])) || Number(y[3]) - Number(x[3]));
  const products: Cell[][] = data.products
    .filter((p) => p.orders + p.orders_prev > 0)
    .map((p) => [accountName.get(p.account_id) ?? null, p.name, p.orders, p.orders_prev, pct(pctChange(p.orders, p.orders_prev)), p.stores, p.stores_prev]);

  const book = buildXlsx([
    {
      name: "Tiendas",
      columns: [
        { header: "Cuenta", width: 20 }, { header: "Tienda", width: 28 }, { header: "Estado", width: 13 },
        { header: `Pedidos (${days} días)`, width: 11 }, { header: `Pedidos (${days} días anteriores)`, width: 13 }, { header: "Cambio %", width: 10 },
        { header: "Diferencia", width: 10 }, { header: "SKUs", width: 8 }, { header: "SKUs antes", width: 9 }, { header: "Días con pedidos", width: 10 },
        { header: "Pedidos por día", width: 10 }, { header: "Unidades por pedido", width: 11 }, { header: "Ticket promedio", width: 11 }, { header: "Moneda", width: 8 },
        { header: "Último pedido", width: 12 }, { header: "Dejó de pedir", width: 40 }, { header: "Último contacto", width: 12 },
        { header: "Pedidos 7 días antes del contacto", width: 14 }, { header: "Pedidos 7 días desde el contacto", width: 14 },
      ],
      rows: stores,
    },
    {
      name: "Tienda × producto",
      columns: [
        { header: "Cuenta", width: 20 }, { header: "Tienda", width: 28 }, { header: "Producto", width: 44 },
        { header: `Pedidos (${days} días)`, width: 11 }, { header: "Pedidos antes", width: 11 }, { header: "Diferencia", width: 10 },
        { header: "Cambio %", width: 10 }, { header: "Movimiento", width: 11 }, { header: "Último pedido", width: 12 },
      ],
      rows: cells,
    },
    {
      name: "Productos",
      columns: [
        { header: "Cuenta", width: 20 }, { header: "Producto", width: 44 }, { header: `Pedidos (${days} días)`, width: 11 }, { header: "Pedidos antes", width: 11 },
        { header: "Cambio %", width: 10 }, { header: "Tiendas", width: 9 }, { header: "Tiendas antes", width: 10 },
      ],
      rows: products,
    },
    {
      name: "Qué ofrecer",
      columns: [{ header: "Cuenta", width: 20 }, { header: "Tienda", width: 28 }, { header: "Estado", width: 13 }, { header: "Producto sugerido", width: 40 }, { header: "Por qué", width: 60 }],
      rows: offers,
    },
  ]);
  const tag = scope.current ? `-${scope.current.name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` : "";
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(book), {
    headers: {
      "content-type": XLSX_TYPE,
      "content-disposition": `attachment; filename="tienda-producto${tag}-${days}-dias-${stamp}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
