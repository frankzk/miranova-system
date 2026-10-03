import Link from "next/link";
import { AutoSelect, GetForm } from "@/components/client";
import { FilterSelect } from "@/components/filter-select";
import { IconArrowRight, IconClose, IconFilter, IconSearch } from "@/components/icons";
import { Masonry } from "@/components/masonry";
import { ProductsSubnav } from "@/components/products-subnav";
import { PageHead } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fmtAgo, fmtInt, fmtMoney, fmtShort } from "@/lib/format";
import { analyzeCatalog, buildSparkline, changeTags, type CatalogChange, type CatalogMovement, type ChangeTag } from "@/lib/catalog";
import {
  applyCatalogFilters, CAT_DEFAULT_SORT, CAT_SORTS, CAT_TABS, catalogContext, catalogFacets, catalogQuery, CHANGE_KINDS,
  countryOfCurrency, parseCatalogFilters, PRICE_BANDS, type CatalogSort,
} from "@/lib/catalog-filters";
import { catalogAccounts, listCatalogChanges, listCatalogMovement, listCatalogSeries } from "@/lib/catalog-data";
import "./competencia.css";

export const metadata = { title: "Competencia" };
export const dynamic = "force-dynamic";

const PATH = "/products/competencia";
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

export default async function CompetenciaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePermission("products");
  const canAccounts = can(user, "accounts");
  const sp = await searchParams;
  const sources = await catalogAccounts();
  const [movement, changes, series] = sources.length
    ? await Promise.all([listCatalogMovement(null, 30), listCatalogChanges(null, 30), listCatalogSeries(null, 30)])
    : ([[], [], new Map()] as [CatalogMovement[], CatalogChange[], Map<string, number[]>]);
  const a = analyzeCatalog(movement, { top: 15 });
  const lastSync = sources.map((s) => s.catalog_sync_at).filter(Boolean).sort().pop() ?? null;
  const syncError = canAccounts ? sources.find((s) => s.catalog_sync_msg && !s.catalog_sync_msg.includes("actualizados")) : undefined;

  const moving = movement.filter((m) => m.unitsDown > 0);
  const totalUnits = moving.reduce((t, m) => t + m.unitsDown, 0);

  const imgByCode = new Map<string, string | null>();
  for (const m of movement) if (m.id && !imgByCode.has(m.id)) imgByCode.set(m.id, m.image);
  const changeByCode = new Map<string, CatalogChange>();
  for (const c of changes) if (c.code && !changeByCode.has(c.code)) changeByCode.set(c.code, c);

  // filtros y orden de la cuadrícula; cada opción muestra cuántos productos deja
  const cf = parseCatalogFilters(sp);
  const ctx = catalogContext(movement, changes);
  const rows = applyCatalogFilters(movement, cf, ctx);
  const facets = catalogFacets(movement, cf, ctx);
  const href = (patch: Record<string, string | undefined>) => {
    const s = catalogQuery(cf, patch);
    return s ? `${PATH}?${s}` : PATH;
  };
  const CLEAR = { q: undefined, f: undefined, pais: undefined, prov: undefined, precio: undefined, cambio: undefined, sort: undefined };
  const applied = [
    cf.country && { key: "pais", label: `País: ${countryOfCurrency(cf.country)}` },
    cf.vendor && { key: "prov", label: `Proveedor: ${cf.vendor}` },
    cf.price && { key: "precio", label: `Precio: ${PRICE_BANDS[cf.price]}` },
    cf.change && { key: "cambio", label: CHANGE_KINDS[cf.change] },
  ].filter(Boolean) as { key: string; label: string }[];
  const filtered = Boolean(cf.q || cf.tab || cf.sort || applied.length);
  const showCountry = facets.countries.options.length > 1 || Boolean(cf.country);
  const byCurrency = cf.sort?.startsWith("cost") && new Set(rows.map((m) => m.currency)).size > 1;
  const withCount = (label: string, n: number) => `${label} (${fmtInt(n)})`;

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
            <Link className="metric" href={href({ ...CLEAR, f: "moving" })}>
              <span className="label">En movimiento</span>
              <span className="value">{fmtInt(moving.length)}</span>
              <span className="foot">{fmtInt(totalUnits)} u. movidas en 30 días<IconArrowRight className="go" /></span>
            </Link>
            <Link className="metric" href={href({ ...CLEAR, f: "out" })} data-alert={a.summary.outOfStock > 0 ? "true" : undefined}>
              <span className="label">Agotados</span>
              <span className="value">{fmtInt(a.summary.outOfStock)}</span>
              <span className="foot">sin stock ahora<IconArrowRight className="go" /></span>
            </Link>
            <div className="metric">
              <span className="label">Cambios</span>
              <span className="value">{fmtInt(changes.length)}</span>
              <span className="foot">precio o stock · 30 días</span>
            </div>
          </section>

          <h2>Catálogo</h2>
          <nav className="tabs" aria-label="Filtrar catálogo">
            {CAT_TABS.map((t) => (
              <Link key={t.id || "all"} href={href({ f: t.id })} aria-current={cf.tab === t.id}>
                {t.label} <span className="c">{fmtInt(facets.tabs[t.id] ?? 0)}</span>
              </Link>
            ))}
          </nav>

          <GetForm className="toolbar" role="search">
            {cf.tab && <input type="hidden" name="f" value={cf.tab} />}
            <label className="input-icon search">
              <span className="sr-only">Buscar en el catálogo</span>
              <IconSearch />
              <input className="input" type="search" name="q" defaultValue={cf.q} placeholder="Producto, proveedor o código" />
            </label>
            <button className="btn" type="submit">Buscar</button>
            <details className="more-filters">
              <summary className="btn">
                <IconFilter /> Filtros{applied.length > 0 && <span className="c">{applied.length}</span>}
              </summary>
              <div className="more-panel">
                {showCountry && (
                  <FilterSelect name="pais" label="País del proveedor" value={cf.country}
                    all={withCount("Todos los países", facets.countries.all)} options={facets.countries.options} />
                )}
                <FilterSelect name="prov" label="Proveedor" value={cf.vendor}
                  all={withCount("Todos los proveedores", facets.vendors.all)} options={facets.vendors.options} />
                <FilterSelect name="precio" label="Precio proveedor" hint="por tercios, dentro de cada país" value={cf.price}
                  all={withCount("Todos los precios", facets.prices.all)} options={facets.prices.options} />
                <FilterSelect name="cambio" label="Cambios en 30 días" value={cf.change}
                  all={withCount("Con y sin cambios", facets.changes.all)} options={facets.changes.options} />
              </div>
            </details>
            {filtered && <Link className="btn btn-ghost" href={href(CLEAR)}>Limpiar</Link>}
            <span className="spacer" />
            <label className="cat-sort">
              <span>Ordenar</span>
              <AutoSelect name="sort" defaultValue={cf.sort ?? ""}>
                <option value="">{CAT_DEFAULT_SORT}</option>
                {(Object.keys(CAT_SORTS) as CatalogSort[]).map((k) => (
                  <option key={k} value={k}>{CAT_SORTS[k]}</option>
                ))}
              </AutoSelect>
            </label>
          </GetForm>

          {applied.length > 0 && (
            <div className="applied" aria-label="Filtros aplicados">
              {applied.map((x) => (
                <Link key={x.key} href={href({ [x.key]: undefined })} aria-label={`Quitar ${x.label}`}>
                  {x.label} <IconClose />
                </Link>
              ))}
            </div>
          )}

          <p className="cat-count" role="status">
            {rows.length === movement.length
              ? `${fmtInt(rows.length)} productos`
              : `${fmtInt(rows.length)} de ${fmtInt(movement.length)} productos`}
            {byCurrency && " · ordenados dentro de cada moneda"}
          </p>

          {rows.length === 0 ? (
            <div className="empty">
              <h3>Nada con estos filtros</h3>
              <p>Prueba con otra búsqueda o quita algún filtro.</p>
              <Link className="btn" href={href(CLEAR)}>Limpiar filtros</Link>
            </div>
          ) : (
            <Masonry className="cat-grid">
              {rows.map((m, i) => {
                const ch = m.id ? changeByCode.get(m.id) : undefined;
                const tags = ch ? changeTags(ch).filter((t) => !t.kind.startsWith("price")).slice(0, 2) : [];
                const spark = m.id ? buildSparkline(series.get(m.id) ?? []) : null;
                return (
                  <article className="cat-card" key={`${m.id ?? m.name}-${i}`}>
                    <figure className="cat-fig" data-trend={spark ? "true" : undefined}>
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
                      {spark && (
                        <div className="cat-trend" aria-hidden>
                          <span className="cat-trend-head">Stock · 30 días</span>
                          <svg
                            className="cat-spark"
                            viewBox={`0 0 ${spark.w} ${spark.h}`}
                            preserveAspectRatio="none"
                            role="img"
                            aria-label="Tendencia de stock"
                          >
                            <path className="cat-spark-area" d={spark.area} />
                            <path className="cat-spark-line" d={spark.line} />
                          </svg>
                          <span className="cat-trend-foot">
                            <span className="cat-trend-range">{fmtInt(spark.first)} → {fmtInt(spark.lastVal)} u.</span>
                            {m.unitsDown > 0 ? (
                              <span className="pill" data-tone="info">−{fmtInt(m.unitsDown)} u.</span>
                            ) : m.unitsUp > 0 ? (
                              <span className="pill" data-tone="neutral">+{fmtInt(m.unitsUp)} u.</span>
                            ) : null}
                          </span>
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
            </Masonry>
          )}

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
