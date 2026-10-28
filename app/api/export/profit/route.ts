import { NextResponse, type NextRequest } from "next/server";
import { listAccounts } from "@/lib/accounts";
import { authorizeRoute } from "@/lib/auth";
import { todayIn } from "@/lib/format";
import {
  carrierLabel, costFx, coverage, dailyTotals, dayBuckets, marketEconomics, margin, profitPeriod, realize, windowStart,
} from "@/lib/profit";
import { listProfitProducts, marketAccounts, profitDelivered, ratesOf } from "@/lib/profit-data";
import { getScope } from "@/lib/scope";
import { buildXlsx, XLSX_TYPE, type Cell } from "@/lib/xlsx";

// Rentabilidad en Excel: el período elegido (por producto, por cuenta, por día y lo que no tiene
// ficha) y la ficha de costos completa. Montos en dólares; precios en la moneda de cada cuenta.

const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
const pct = (n: number | null) => (n === null ? null : Math.round(n * 1000) / 10);

export async function GET(req: NextRequest) {
  const user = await authorizeRoute("profit", "export");
  if (user instanceof Response) return user;
  const sp = req.nextUrl.searchParams;
  const accountsAll = await listAccounts();
  const scope = await getScope(accountsAll);
  const today = todayIn(scope.tz);
  const period = profitPeriod("custom", today, { from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined });
  const byOrder = sp.get("b") === "pedido";
  const [accounts, products, data] = await Promise.all([
    marketAccounts(),
    listProfitProducts(),
    profitDelivered(windowStart(today, period), byOrder ? "ordered" : "delivered"),
  ]);
  const rates = ratesOf(accounts);
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;
  const cur = realize(data, products, rates, { from: period.from, to: period.to, account: scope.account });
  const daily = dailyTotals(data, products, rates, scope.account);

  const byProduct: Cell[][] = cur.products.map((p) => [
    p.name, p.accounts.map(name).join(", "), p.units, p.community_units || null, p.users_units || null,
    r2(p.revenue), r2(p.fees), p.has_cost ? r2(p.cost) : null, p.has_cost ? r2(p.profit) : null,
    p.has_cost ? pct(margin(p)) : null, p.has_cost && p.covered_units ? r2(p.profit / p.covered_units) : null,
  ]);
  const byAccount: Cell[][] = cur.accounts.map((a) => [
    name(a.account_id), a.orders, a.units, r2(a.revenue), r2(a.covered_fees), r2(a.cost), r2(a.profit), pct(margin(a)), pct(coverage(a)),
  ]);
  const byDay: Cell[][] = dayBuckets(daily, period.from, period.to).map((d) => [
    d.key, d.acc.orders, d.acc.units, r2(d.acc.revenue), r2(d.acc.covered_fees), r2(d.acc.cost), r2(d.acc.profit), r2(d.acc.revenue - d.acc.covered_revenue),
  ]);
  const unlinked: Cell[][] = cur.unlinked.map((u) => [name(u.account_id), u.name, u.units, u.orders, r2(u.revenue)]);
  const costs: Cell[][] = [];
  for (const p of products) {
    const markets = p.markets.length ? p.markets : [null];
    for (const m of markets) {
      const a = m ? accounts.find((x) => x.id === m.account_id) : undefined;
      const e = m ? marketEconomics(p, m, a?.usd_rate ?? null) : null;
      costs.push([
        p.name, a?.name ?? null, p.cost_currency, p.cost_currency !== "USD" ? costFx(p) : null,
        p.unit_cost, p.import_cost, p.pickup_cost,
        m ? carrierLabel(m.carrier) : null, m?.transfer_cost ?? null,
        r2(e?.cost_total ?? null), r2(e?.pickup ?? null), r2(e?.transfer ?? null), e ? 1.2 : null,
        e?.landed === null || e?.landed === undefined ? null : r2(e.landed + 1.2),
        a?.currency ?? null, m?.price_community ?? null, m?.price_users ?? null,
        r2(e?.community?.profit ?? null), pct(e?.community?.margin ?? null), r2(e?.users?.profit ?? null), pct(e?.users?.margin ?? null),
        m?.qty_in ?? null, r2(e?.investment ?? null), p.notes,
      ]);
    }
  }

  const usd = (h: string, width = 13) => ({ header: `${h} (USD)`, width });
  const book = buildXlsx([
    {
      name: "Por producto",
      columns: [
        { header: "Producto", width: 36 }, { header: "Cuentas", width: 26 }, { header: "Unidades", width: 10 },
        { header: "Unid. comunidad", width: 11 }, { header: "Unid. usuarios", width: 11 },
        usd("Cobrado a Drop"), usd("Drop descontó"), usd("Costo puesto"), usd("Utilidad"), { header: "Margen %", width: 10 }, usd("Utilidad por unidad"),
      ],
      rows: byProduct,
    },
    {
      name: "Por cuenta",
      columns: [
        { header: "Cuenta", width: 28 }, { header: "Pedidos", width: 10 }, { header: "Unidades", width: 10 }, usd("Cobrado a Drop"),
        usd("Drop descontó (con costo)"), usd("Costo puesto"), usd("Utilidad"), { header: "Margen %", width: 10 }, { header: "Con costo %", width: 11 },
      ],
      rows: byAccount,
    },
    {
      name: "Por día",
      columns: [
        { header: "Día", width: 12 }, { header: "Pedidos", width: 10 }, { header: "Unidades", width: 10 }, usd("Cobrado a Drop"),
        usd("Drop descontó (con costo)"), usd("Costo puesto"), usd("Utilidad"), usd("Cobrado sin costo"),
      ],
      rows: byDay,
    },
    {
      name: "Sin ficha",
      columns: [{ header: "Cuenta", width: 28 }, { header: "Producto", width: 44 }, { header: "Unidades", width: 10 }, { header: "Pedidos", width: 10 }, usd("Cobrado a Drop")],
      rows: unlinked,
    },
    {
      name: "Costos por producto",
      columns: [
        { header: "Producto", width: 34 }, { header: "Cuenta", width: 24 }, { header: "Moneda de costos", width: 10 }, { header: "Tipo de cambio (moneda de costos por USD)", width: 16 },
        { header: "Costo", width: 10 }, { header: "Costo de importación", width: 11 }, { header: "Recolección en GT", width: 11 },
        { header: "Transportista", width: 18 }, { header: "Traslado", width: 10 },
        usd("Costo total"), usd("Recolección"), usd("Traslado"), usd("Fulfillment", 11), usd("Costo final"),
        { header: "Moneda de la cuenta", width: 10 }, { header: "Precio comunidad", width: 11 }, { header: "Precio usuarios", width: 11 },
        usd("Rentabilidad comunidad"), { header: "Margen comunidad %", width: 11 }, usd("Rentabilidad usuarios"), { header: "Margen usuarios %", width: 11 },
        { header: "Cantidad ingresada", width: 11 }, usd("Inversión"), { header: "Notas", width: 30 },
      ],
      rows: costs,
    },
  ]);
  const scopeTag = scope.account ? `-${(scope.current?.name ?? "cuenta").toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
  return new NextResponse(Buffer.from(book), {
    headers: {
      "content-type": XLSX_TYPE,
      "content-disposition": `attachment; filename="rentabilidad-miranova${scopeTag}-${period.from}-a-${period.to}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
