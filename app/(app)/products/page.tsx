import Link from "next/link";
import { AccountChips } from "@/components/account-chips";
import { GetForm } from "@/components/client";
import { ColumnFilter, type FilterOption } from "@/components/column-filter";
import { FilterSelect } from "@/components/filter-select";
import { IconClose, IconDownload, IconFilter, IconSearch } from "@/components/icons";
import { ProductPhotos } from "@/components/product-photos";
import { ProductsSubnav } from "@/components/products-subnav";
import { PageHead } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { requirePermission } from "@/lib/auth";
import { fmtAgo, fmtInt, fmtMoney } from "@/lib/format";
import {
  applyProductFilters, inTab, isActive, LOW_STOCK, parseProductFilters, PHOTOS, PRODUCT_SORTS, productQuery, refine,
  SALES_DAYS, soldOf, TABS, VARIANTS, type ProductSort,
} from "@/lib/product-filters";
import { mediaKey } from "@/lib/media-rules";
import { mediaByKey } from "@/lib/product-media";
import { listProducts, productSales, type Product } from "@/lib/queries";
import { listUsers } from "@/lib/users";
import { can } from "@/lib/permissions";
import { getScope } from "@/lib/scope";

export const metadata = { title: "Productos" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, accounts] = await Promise.all([requirePermission("products"), listAccounts()]);
  const canExport = can(user, "export");
  const canAccounts = can(user, "accounts");
  const sp = await searchParams;
  const scope = await getScope(accounts);
  const [all, sales, media, users, everywhere] = await Promise.all([
    listProducts(scope.account),
    productSales(scope.account, SALES_DAYS),
    mediaByKey(),
    listUsers(),
    // las fotos van por SKU en todos los países: para decir en cuáles, hace falta el catálogo completo
    scope.account ? listProducts() : null,
  ]);
  const canPhotos = can(user, "photos");
  const photosOf = (p: Product) => media.get(mediaKey(p)) ?? [];
  const hasPhotos = (p: Product) => photosOf(p).length > 0;
  const country = new Map(accounts.map((a) => [a.id, a.country]));
  const countriesOf = new Map<string, string[]>();
  for (const p of everywhere ?? all) {
    const k = mediaKey(p);
    const c = country.get(p.account_id);
    const list = countriesOf.get(k) ?? [];
    if (c && !list.includes(c)) list.push(c);
    countriesOf.set(k, list);
  }
  const who = new Map(users.map((u) => [u.id, u.name.split(" ")[0]]));

  const pf = parseProductFilters(sp);
  const f = pf.tab;
  const refined = refine(all, pf, hasPhotos);
  const rows = applyProductFilters(all, pf, sales, hasPhotos);
  const counts = Object.fromEntries(TABS.map((x) => [x.id, refined.filter((p) => inTab(p, x.id)).length]));

  const showAccount = !scope.account && accounts.length > 1;
  const lastSync = accounts
    .map((a) => a.products_sync_at)
    .filter(Boolean)
    .sort()
    .pop() ?? null;
  // el error de sincronización es de Cuentas
  const syncError = canAccounts && accounts.find((a) => a.products_sync_msg?.startsWith("No se pudo"));
  const href = (patch: Record<string, string | undefined>) => {
    const s = productQuery(pf, patch);
    return s ? `/products?${s}` : "/products";
  };
  const without = (key: string) => productQuery(pf, { [key]: undefined });
  const exportQs = productQuery(pf);

  // opciones de los filtros por columna
  const statusCounts = new Map<string, number>();
  for (const p of all) statusCounts.set(p.status ?? "", (statusCounts.get(p.status ?? "") ?? 0) + 1);
  const statusOpts: FilterOption[] = [...statusCounts]
    .filter(([v]) => v)
    .sort((a, b) => b[1] - a[1])
    .map(([v, n]) => ({ value: v, label: v, count: n }));
  const withVariants = all.filter((p) => p.variants_count > 0).length;
  const variantOpts: FilterOption[] = [
    { value: "con", label: VARIANTS.con, count: withVariants },
    { value: "sin", label: VARIANTS.sin, count: all.length - withVariants },
  ];
  const sortOpts = (keys: ProductSort[]): FilterOption[] => keys.map((k) => ({ value: k, label: PRODUCT_SORTS[k] }));
  const sortIn = (keys: ProductSort[]) => (pf.sort && keys.includes(pf.sort) ? pf.sort : undefined);
  const S = {
    name: ["name_asc", "name_desc"] as ProductSort[],
    price: ["price_desc", "price_asc"] as ProductSort[],
    stock: ["stock_desc", "stock_asc"] as ProductSort[],
    sold: ["sold_desc", "sold_asc"] as ProductSort[],
  };

  const withPhotos = all.filter(hasPhotos).length;
  const photoOpts: FilterOption[] = [
    { value: "con", label: PHOTOS.con, count: withPhotos },
    { value: "sin", label: PHOTOS.sin, count: all.length - withPhotos },
  ];

  const applied = [
    pf.status && { key: "status", label: `Estado: ${pf.status}` },
    pf.variants && { key: "var", label: VARIANTS[pf.variants] },
    pf.photos && { key: "ph", label: PHOTOS[pf.photos] },
    pf.sort && { key: "sort", label: `Orden: ${PRODUCT_SORTS[pf.sort]}` },
  ].filter(Boolean) as { key: string; label: string }[];

  return (
    <div className="page">
      <PageHead
        title="Productos"
        sub={<>{fmtInt(all.length)} en el catálogo · {scope.label}{lastSync && <> · actualizado {fmtAgo(lastSync)}</>}</>}
        actions={canExport && all.length > 0 && (
          <a className="btn" href={`/api/export/products${exportQs ? `?${exportQs}` : ""}`}>
            <IconDownload /> Exportar CSV
          </a>
        )}
      />

      {syncError && (
        <div className="banner" data-tone="danger" role="status">
          <span>{syncError.name}: {syncError.products_sync_msg}</span>
        </div>
      )}

      <ProductsSubnav />

      <AccountChips accounts={accounts} current={scope.account} next={href({})} />

      <nav className="tabs" aria-label="Filtrar productos">
        {TABS.map((x) => (
          <Link key={x.id || "all"} href={href({ f: x.id })} aria-current={f === x.id}>
            {x.label} <span className="c">{fmtInt(counts[x.id] ?? 0)}</span>
          </Link>
        ))}
      </nav>

      <GetForm className="toolbar" role="search">
        {f && <input type="hidden" name="f" value={f} />}
        <label className="input-icon search">
          <span className="sr-only">Buscar producto</span>
          <IconSearch />
          <input className="input" type="search" name="q" defaultValue={pf.q} placeholder="Nombre, SKU o código" />
        </label>
        <button className="btn" type="submit">Buscar</button>
        <details className="more-filters">
          <summary className="btn">
            <IconFilter /> Filtros{applied.length > 0 && <span className="c">{applied.length}</span>}
          </summary>
          <div className="more-panel">
            <FilterSelect name="status" label="Estado" value={pf.status} all="Todos los estados" options={statusOpts} />
            <FilterSelect name="var" label="Variantes" value={pf.variants} all="Con y sin variantes" options={variantOpts} />
            <FilterSelect name="ph" label="Fotos reales" value={pf.photos} all="Con y sin fotos reales" options={photoOpts} />
            <FilterSelect name="sort" label="Ordenar por" value={pf.sort} all="Más nuevos primero" options={sortOpts(Object.keys(PRODUCT_SORTS) as ProductSort[])} />
          </div>
        </details>
        {(pf.q || applied.length > 0) && <Link className="btn btn-ghost" href={href({ q: undefined, status: undefined, var: undefined, ph: undefined, sort: undefined })}>Limpiar</Link>}
      </GetForm>

      {applied.length > 0 && (
        <div className="applied" aria-label="Filtros aplicados">
          {applied.map((a) => (
            <Link key={a.key} href={href({ [a.key]: undefined })} aria-label={`Quitar ${a.label}`}>
              {a.label} <IconClose />
            </Link>
          ))}
        </div>
      )}

      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty">
            <h3>{all.length === 0 ? "Aún no hay productos" : "Nada con estos filtros"}</h3>
            <p>
              {all.length === 0
                ? `El catálogo se descarga con la sincronización de tus cuentas (cada 10 minutos).${canAccounts ? " También puedes sincronizar ahora desde Cuentas." : ""}`
                : "Prueba con otra búsqueda o cambia de pestaña."}
            </p>
            {all.length === 0 && canAccounts && <Link className="btn" href="/settings">Ir a Cuentas</Link>}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table stack">
              <thead>
                <tr>
                  <th><ColumnFilter path="/products" label="Producto" param="sort" query={without("sort")} current={sortIn(S.name)} allLabel="Más nuevos primero" options={sortOpts(S.name)} title="Ordenar por nombre" /></th>
                  <th className="hide-md"><ColumnFilter path="/products" label="SKU" param="var" query={without("var")} current={pf.variants} allLabel="Con y sin variantes" options={variantOpts} title="Filtrar por variantes" /></th>
                  <th><ColumnFilter path="/products" label="Estado" param="status" query={without("status")} current={pf.status} allLabel="Todos los estados" options={statusOpts} /></th>
                  <th className="r"><ColumnFilter path="/products" label="Precio" param="sort" align="right" query={without("sort")} current={sortIn(S.price)} allLabel="Más nuevos primero" options={sortOpts(S.price)} title="Ordenar por precio" /></th>
                  <th className="r"><ColumnFilter path="/products" label="Inventario" param="sort" align="right" query={without("sort")} current={sortIn(S.stock)} allLabel="Más nuevos primero" options={sortOpts(S.stock)} title="Ordenar por inventario" /></th>
                  <th className="r hide-md"><ColumnFilter path="/products" label={`Vendido ${SALES_DAYS} d`} param="sort" align="right" query={without("sort")} current={sortIn(S.sold)} allLabel="Más nuevos primero" options={sortOpts(S.sold)} title={`Unidades en órdenes no canceladas de los últimos ${SALES_DAYS} días`} /></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const sold = soldOf(p, sales);
                  const low = p.stock !== null && p.stock <= LOW_STOCK;
                  return (
                    <tr key={p.id}>
                      <td data-slot="id">
                        <div className="product-cell">
                          <ProductPhotos
                            mediaKey={mediaKey(p)}
                            name={p.name}
                            sku={p.sku?.trim() || null}
                            image={p.image_url}
                            countries={countriesOf.get(mediaKey(p)) ?? []}
                            canEdit={canPhotos}
                            items={photosOf(p).map((m) => ({
                              id: m.id, kind: m.kind, content_type: m.content_type, size_bytes: m.size_bytes, caption: m.caption,
                              created_at: m.created_at, by: m.uploaded_by ? who.get(m.uploaded_by) ?? null : null,
                            }))}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div className="strong clip" style={{ maxWidth: 340 }} title={p.name}>{p.name}</div>
                            <div className="sub">
                              {p.code ?? "—"}
                              {p.variants_count > 0 && <> · {p.variants_count} variantes</>}
                              {showAccount && p.accounts && <> · {p.accounts.name}</>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="hide-md hide-sm nowrap">{p.sku ?? "—"}</td>
                      <td data-slot="status">
                        <span className="pill" data-tone={isActive(p) ? "success" : "neutral"}>{p.status ?? "—"}</span>
                      </td>
                      <td data-slot="total" className="num strong">
                        {p.variants_count > 0 && <span className="muted" style={{ fontWeight: 400 }}>desde </span>}
                        {fmtMoney(p.price, p.currency ?? "HNL")}
                      </td>
                      <td data-slot="customer" className="num">
                        <span style={{ color: (p.stock ?? 0) <= 0 ? "var(--danger)" : low ? "var(--warning)" : undefined, fontWeight: low ? 600 : 400 }}>
                          {p.stock === null ? "—" : `${fmtInt(p.stock)} u.`}
                        </span>
                      </td>
                      <td className="num hide-md hide-sm">{sold ? `${fmtInt(sold.units)} u.` : <span className="subtle">0</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
