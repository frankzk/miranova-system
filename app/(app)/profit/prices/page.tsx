import Link from "next/link";
import { ProductPricesForm } from "@/components/product-prices-form";
import { ProfitSubnav } from "@/components/profit-subnav";
import { SideSheet } from "@/components/side-sheet";
import { PageHead } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { currencySymbol } from "@/lib/format";
import { can, permissionFlags } from "@/lib/permissions";
import { priceProduct } from "@/lib/profit-access";
import { normName } from "@/lib/profit";
import { listProfitProducts, marketAccounts } from "@/lib/profit-data";
import { saveProductPrices } from "../actions";
import "../../imports/imports.css";
import "../profit.css";

export const metadata = { title: "Precios comerciales" };
export default async function ProductPricesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePermission("product_prices");
  const [products, accounts, sp] = await Promise.all([
    listProfitProducts().then((ps) => ps.map(priceProduct)), marketAccounts(), searchParams,
  ]);
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 120) : "";
  const rows = q ? products.filter((p) => normName(p.name).includes(normName(q))) : products;
  const format = (n: number | null, currency: string) => n === null ? "—" : `${currencySymbol(currency)}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return <div className="page pf-page">
    <PageHead title="Precios comerciales" sub="Precios comunidad y usuarios por producto y cuenta" />
    <ProfitSubnav sheets={products.length} perms={permissionFlags(user)} />
    <form className="pf-toolbar" action="/profit/prices" role="search">
      <input className="input" type="search" name="q" defaultValue={q} placeholder="Buscar producto" aria-label="Buscar producto" />
      <button className="btn" type="submit">Buscar</button>
      {q && <Link className="btn btn-ghost" href="/profit/prices">Ver todos</Link>}
    </form>
    {rows.length ? <section className="table-wrap" aria-label="Precios por producto">
      <div className="table-scroll"><table className="table">
        <thead><tr><th scope="col">Producto / cuenta</th><th scope="col" className="r">Comunidad</th><th scope="col" className="r">Usuarios</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
        {rows.map((p) => <tbody key={p.id}>
          <tr><th scope="row" colSpan={3}>{p.name}</th><td>
            <SideSheet trigger="Editar precios" triggerClass="btn btn-ghost btn-sm" title={p.name} sub="Precios comerciales">
              <ProductPricesForm product={p} accounts={accounts.map(({ id, name, currency }) => ({ id, name, currency }))} action={saveProductPrices} />
            </SideSheet>
          </td></tr>
          {accounts.filter((a) => p.markets.some((m) => m.account_id === a.id)).map((a) => {
            const m = p.markets.find((m) => m.account_id === a.id)!;
            return <tr key={a.id}><th scope="row">{a.name} <span className="muted">({a.currency})</span></th>
              <td className="num">{format(m.price_community, a.currency)}</td><td className="num">{format(m.price_users, a.currency)}</td><td /></tr>;
          })}
        </tbody>)}
      </table></div>
    </section> : <div className="empty"><h3>{q ? "No hay productos con ese nombre" : "Aún no hay fichas de productos"}</h3>
      <p>Los productos se crean en Costos de productos. Después puedes configurar aquí sus precios.</p>
      {can(user, "product_costs") && <Link href="/profit/costs#nueva" className="btn">Crear ficha</Link>}
    </div>}
  </div>;
}
