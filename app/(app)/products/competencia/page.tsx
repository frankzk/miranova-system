import Link from "next/link";
import { ProductsSubnav } from "@/components/products-subnav";
import { PageHead } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fmtAgo, fmtInt, fmtMoney } from "@/lib/format";
import { analyzeCatalog } from "@/lib/catalog";
import { catalogAccounts, listCatalog } from "@/lib/catalog-data";

export const metadata = { title: "Competencia" };
export const dynamic = "force-dynamic";

const pct = (x: number | null) => (x === null ? "—" : `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export default async function CompetenciaPage() {
  const user = await requirePermission("products");
  const canAccounts = can(user, "accounts");
  const sources = await catalogAccounts();
  const products = sources.length ? await listCatalog(null) : [];
  const a = analyzeCatalog(products, { top: 15 });
  const cur = a.currency;
  const lastSync = sources.map((s) => s.catalog_sync_at).filter(Boolean).sort().pop() ?? null;
  const syncError = canAccounts ? sources.find((s) => s.catalog_sync_msg && !s.catalog_sync_msg.includes("actualizados")) : undefined;

  return (
    <div className="page">
      <PageHead
        title="Competencia"
        sub={
          <>
            {fmtInt(a.summary.products)} productos · {fmtInt(a.summary.vendors)} proveedores
            {lastSync && <> · actualizado {fmtAgo(lastSync)}</>}
          </>
        }
      />

      <ProductsSubnav />

      {syncError && (
        <div className="banner" data-tone="danger" role="status">
          <span>{syncError.name}: {syncError.catalog_sync_msg}</span>
        </div>
      )}

      {sources.length === 0 ? (
        <div className="empty">
          <h3>Aún no hay una cuenta de dropshipper conectada</h3>
          <p>
            Para espiar el catálogo de la competencia, agrega en Ajustes una cuenta de <strong>dropshipper</strong> de
            Drop y marca <strong>“Solo catálogo de competencia”</strong>. El sistema bajará el catálogo cada 10 minutos,
            igual que las órdenes.
          </p>
          {canAccounts && <Link className="btn" href="/settings">Ir a Cuentas</Link>}
        </div>
      ) : products.length === 0 ? (
        <div className="empty">
          <h3>Catálogo en camino</h3>
          <p>La cuenta está conectada; el catálogo se baja en la próxima sincronización (cada 10 minutos).</p>
        </div>
      ) : (
        <>
          <section className="metrics" aria-label="Resumen del catálogo">
            <div className="metric">
              <span className="label">Productos</span>
              <span className="value">{fmtInt(a.summary.products)}</span>
              <span className="foot">{fmtInt(a.summary.withPrices)} con margen medible</span>
            </div>
            <div className="metric">
              <span className="label">Proveedores</span>
              <span className="value">{fmtInt(a.summary.vendors)}</span>
              <span className="foot">{fmtInt(a.duplicates.length)} productos en más de uno</span>
            </div>
            <div className="metric">
              <span className="label">Margen mediano</span>
              <span className="value">{pct(a.marginPct?.median ?? null)}</span>
              <span className="foot">rango {pct(a.marginPct?.min ?? null)} a {pct(a.marginPct?.max ?? null)}</span>
            </div>
            <div className="metric">
              <span className="label">Costo mediano</span>
              <span className="value sm">{fmtMoney(a.cost?.median ?? null, cur)}</span>
              <span className="foot">sugerido {fmtMoney(a.suggested?.median ?? null, cur)}</span>
            </div>
          </section>

          <h2>Mejor para pautar (costo bajo + buen margen)</h2>
          <div className="table-wrap">
            <div className="table-scroll">
              <table className="table stack">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="hide-md">Proveedor</th>
                    <th className="r">Costo</th>
                    <th className="r">Sugerido</th>
                    <th className="r">Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {a.bestEntry.map((p, i) => (
                    <tr key={`${p.id}-${i}`}>
                      <td data-slot="id"><span className="strong clip" title={p.name}>{clip(p.name, 48)}</span></td>
                      <td className="hide-md hide-sm">{p.vendor ?? "—"}</td>
                      <td data-slot="total" className="num">{fmtMoney(p.cost, cur)}</td>
                      <td data-slot="customer" className="num">{fmtMoney(p.suggested, cur)}</td>
                      <td className="num strong">{pct(p.marginPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <h2>Por proveedor</h2>
          <div className="table-wrap">
            <div className="table-scroll">
              <table className="table stack">
                <thead>
                  <tr>
                    <th>Proveedor</th>
                    <th className="r">Productos</th>
                    <th className="r">Margen medio</th>
                    <th className="r hide-md">Rango de costo</th>
                    <th className="r hide-md">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {a.byVendor.slice(0, 20).map((v) => (
                    <tr key={v.vendor}>
                      <td data-slot="id"><span className="strong">{clip(v.vendor, 40)}</span></td>
                      <td data-slot="total" className="num">{fmtInt(v.products)}</td>
                      <td data-slot="customer" className="num">{pct(v.medianMarginPct)}</td>
                      <td className="num hide-md hide-sm">
                        {v.costRange ? `${fmtMoney(v.costRange[0], cur)}–${fmtMoney(v.costRange[1], cur)}` : "—"}
                      </td>
                      <td className="num hide-md hide-sm">{fmtInt(v.totalStock)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {a.duplicates.length > 0 && (
            <>
              <h2>Mismo producto en varios proveedores</h2>
              <div className="table-wrap">
                <div className="table-scroll">
                  <table className="table stack">
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th className="r">Ofertas</th>
                        <th className="r">Más barato</th>
                        <th className="hide-md">Proveedor más barato</th>
                        <th className="r hide-md">Diferencia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.duplicates.slice(0, 25).map((d, i) => (
                        <tr key={`${d.name}-${i}`}>
                          <td data-slot="id"><span className="strong clip" title={d.name}>{clip(d.name, 44)}</span></td>
                          <td data-slot="total" className="num">{fmtInt(d.offers)}</td>
                          <td data-slot="customer" className="num">{d.cheapest ? fmtMoney(d.cheapest.cost, cur) : "—"}</td>
                          <td className="hide-md hide-sm">{d.cheapest?.vendor ?? "—"}</td>
                          <td className="num hide-md hide-sm">{d.spread ? fmtMoney(d.spread, cur) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
