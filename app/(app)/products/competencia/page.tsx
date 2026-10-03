import Link from "next/link";
import { ProductsSubnav } from "@/components/products-subnav";
import { PageHead } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fmtAgo, fmtInt, fmtMoney, fmtShort } from "@/lib/format";
import { analyzeCatalog, changeTags, type CatalogChange, type ChangeTag } from "@/lib/catalog";
import { catalogAccounts, listCatalogChanges, listCatalogMovement } from "@/lib/catalog-data";
import "./competencia.css";

export const metadata = { title: "Competencia" };
export const dynamic = "force-dynamic";

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const TONE: Record<ChangeTag["tone"], string> = { down: "danger", up: "success", warning: "warning", neutral: "neutral" };

/** Antes → ahora del campo que cambió, en la moneda del producto. */
function detail(c: CatalogChange): string {
  const cur = c.currency;
  if (c.prevStock !== null && c.stock !== null && c.stock !== c.prevStock) return `${fmtInt(c.prevStock)} → ${fmtInt(c.stock)} u.`;
  if (c.prevCost !== null && c.cost !== null && c.cost !== c.prevCost) return `costo ${fmtMoney(c.prevCost, cur)} → ${fmtMoney(c.cost, cur)}`;
  if (c.prevSuggested !== null && c.suggested !== null && c.suggested !== c.prevSuggested) return `${fmtMoney(c.prevSuggested, cur)} → ${fmtMoney(c.suggested, cur)}`;
  return "—";
}

export default async function CompetenciaPage() {
  const user = await requirePermission("products");
  const canAccounts = can(user, "accounts");
  const sources = await catalogAccounts();
  const movement = sources.length ? await listCatalogMovement(null, 30) : [];
  const changes = sources.length ? await listCatalogChanges(null, 30) : [];
  const a = analyzeCatalog(movement, { top: 15 });
  const lastSync = sources.map((s) => s.catalog_sync_at).filter(Boolean).sort().pop() ?? null;
  const syncError = canAccounts ? sources.find((s) => s.catalog_sync_msg && !s.catalog_sync_msg.includes("actualizados")) : undefined;

  const moving = movement.filter((m) => m.unitsDown > 0);
  const totalUnits = moving.reduce((t, m) => t + m.unitsDown, 0);

  const imgByCode = new Map<string, string | null>();
  for (const m of movement) if (m.id && !imgByCode.has(m.id)) imgByCode.set(m.id, m.image);
  const changeByCode = new Map<string, CatalogChange>();
  for (const c of changes) if (c.code && !changeByCode.has(c.code)) changeByCode.set(c.code, c);

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
      ) : movement.length === 0 ? (
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
              <span className="foot">{fmtInt(a.summary.vendors)} proveedores</span>
            </div>
            <div className="metric">
              <span className="label">En movimiento</span>
              <span className="value">{fmtInt(moving.length)}</span>
              <span className="foot">{fmtInt(totalUnits)} u. movidas en 30 días</span>
            </div>
            <div className="metric" data-alert={a.summary.outOfStock > 0 ? "true" : undefined}>
              <span className="label">Agotados</span>
              <span className="value">{fmtInt(a.summary.outOfStock)}</span>
              <span className="foot">sin stock ahora</span>
            </div>
            <div className="metric">
              <span className="label">Cambios</span>
              <span className="value">{fmtInt(changes.length)}</span>
              <span className="foot">precio o stock · 30 días</span>
            </div>
          </section>

          <h2>Catálogo · lo que más se mueve</h2>
          <div className="cat-grid">
            {movement.map((m, i) => {
              const ch = m.id ? changeByCode.get(m.id) : undefined;
              const tags = ch ? changeTags(ch).filter((t) => !t.kind.startsWith("price")).slice(0, 2) : [];
              return (
                <article className="cat-card" key={`${m.id ?? m.name}-${i}`}>
                  <figure className="cat-fig">
                    {m.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.image} alt={m.name} loading="lazy" />
                    ) : (
                      <div className="cat-fig--empty">{m.name.slice(0, 1).toUpperCase()}</div>
                    )}
                    {tags.length > 0 && (
                      <div className="cat-badges">
                        {tags.map((t, j) => <span key={j} className="pill" data-tone={TONE[t.tone]}>{t.label}</span>)}
                      </div>
                    )}
                  </figure>
                  <div className="cat-body">
                    <div className="cat-name" title={m.name}>{m.name}</div>
                    <div className="cat-vendor" title={m.vendor ?? ""}>{m.vendor ?? "—"}</div>
                    <div className="cat-foot">
                      <div className="cat-line">
                        <span className="cat-k">Proveedor</span>
                        <span className="cat-cost">{fmtMoney(m.cost, m.currency)}</span>
                      </div>
                      <div className="cat-line">
                        <span className="cat-stock">{m.stock === null ? "— u." : `${fmtInt(m.stock)} u.`}</span>
                        {m.unitsDown > 0 ? (
                          <span className="pill" data-tone="info">−{fmtInt(m.unitsDown)} u.</span>
                        ) : m.unitsUp > 0 ? (
                          <span className="pill" data-tone="neutral">+{fmtInt(m.unitsUp)} u.</span>
                        ) : (
                          <span className="cat-flat">sin movimiento</span>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <h2>Cambios recientes · últimos 30 días</h2>
          {changes.length === 0 ? (
            <p className="sub" style={{ marginTop: -4 }}>
              El rastreo arranca ahora. Cuando un proveedor cambie stock o precio entre sincronizaciones, el cambio aparece acá
              (quiebres, reabastos y re-precios).
            </p>
          ) : (
            <div className="table-wrap">
              <div className="table-scroll">
                <table className="table stack">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th className="hide-md">Proveedor</th>
                      <th>Cambio</th>
                      <th className="hide-md">Detalle</th>
                      <th>Cuándo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes.slice(0, 60).map((c, i) => {
                      const thumb = c.code ? imgByCode.get(c.code) ?? null : null;
                      return (
                        <tr key={`${c.code ?? c.name}-${c.takenAt}-${i}`}>
                          <td data-slot="id">
                            <div className="cat-row-prod">
                              {thumb && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img className="cat-thumb" src={thumb} alt="" loading="lazy" />
                              )}
                              <span className="strong clip" title={c.name}>{clip(c.name, 40)}</span>
                            </div>
                          </td>
                          <td className="hide-md hide-sm">{c.vendor ?? "—"}</td>
                          <td data-slot="status">
                            <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                              {changeTags(c).map((t, j) => (
                                <span key={j} className="pill" data-tone={TONE[t.tone]}>{t.label}</span>
                              ))}
                            </span>
                          </td>
                          <td className="hide-md hide-sm sub">{detail(c)}</td>
                          <td className="sub nowrap">{fmtShort(c.takenAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <h2>Por proveedor</h2>
          <div className="table-wrap">
            <div className="table-scroll">
              <table className="table stack">
                <thead>
                  <tr>
                    <th>Proveedor</th>
                    <th className="r">Productos</th>
                    <th className="r hide-md">Rango de costo</th>
                    <th className="r">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {a.byVendor.slice(0, 20).map((v) => (
                    <tr key={v.vendor}>
                      <td data-slot="id"><span className="strong">{clip(v.vendor, 40)}</span></td>
                      <td data-slot="total" className="num">{fmtInt(v.products)}</td>
                      <td className="num hide-md hide-sm">
                        {v.costRange ? `${fmtMoney(v.costRange[0], v.currency)}–${fmtMoney(v.costRange[1], v.currency)}` : "—"}
                      </td>
                      <td data-slot="customer" className="num">{fmtInt(v.totalStock)}</td>
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
                          <td data-slot="customer" className="num">{d.cheapest ? fmtMoney(d.cheapest.cost, d.currency) : "—"}</td>
                          <td className="hide-md hide-sm">{d.cheapest?.vendor ?? "—"}</td>
                          <td className="num hide-md hide-sm">{d.spread ? fmtMoney(d.spread, d.currency) : "—"}</td>
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
