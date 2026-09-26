import Link from "next/link";
import { IconBox, IconDownload, IconSearch } from "@/components/icons";
import { PageHead } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { fmtAgo, fmtInt, fmtMoney } from "@/lib/format";
import { listProducts, productSales, type Product } from "@/lib/queries";
import { getScope } from "@/lib/scope";

export const metadata = { title: "Productos" };

const LOW_STOCK = 10;
const SALES_DAYS = 30;

const FILTERS = [
  { id: "", label: "Todos" },
  { id: "active", label: "Activos" },
  { id: "low", label: "Stock bajo" },
  { id: "out", label: "Sin stock" },
  { id: "inactive", label: "Inactivos" },
] as const;

const isActive = (p: Product) => !p.status || /activ/i.test(p.status) && !/inactiv/i.test(p.status);

function matches(p: Product, f: string) {
  if (f === "active") return isActive(p);
  if (f === "inactive") return !isActive(p);
  if (f === "out") return (p.stock ?? 0) <= 0;
  if (f === "low") return p.stock !== null && p.stock > 0 && p.stock <= LOW_STOCK;
  return true;
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; f?: string }> }) {
  const sp = await searchParams;
  const accounts = await listAccounts();
  const scope = await getScope(accounts);
  const [all, sales] = await Promise.all([listProducts(scope.account), productSales(scope.account, SALES_DAYS)]);

  const q = (sp.q ?? "").trim().toLowerCase();
  const f = FILTERS.some((x) => x.id === sp.f) ? sp.f ?? "" : "";
  const searched = q
    ? all.filter((p) => [p.name, p.sku, p.code].some((v) => v?.toLowerCase().includes(q)))
    : all;
  const rows = searched.filter((p) => matches(p, f));
  const counts = Object.fromEntries(FILTERS.map((x) => [x.id, searched.filter((p) => matches(p, x.id)).length]));

  const soldOf = (p: Product) => sales[`${p.account_id}:${p.sku ?? ""}`] ?? sales[`${p.account_id}:${p.name}`];
  const showAccount = !scope.account && accounts.length > 1;
  const lastSync = accounts
    .map((a) => a.products_sync_at)
    .filter(Boolean)
    .sort()
    .pop() ?? null;
  const syncError = accounts.find((a) => a.products_sync_msg?.startsWith("No se pudo"));
  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ ...(q ? { q: sp.q! } : {}), ...(f ? { f } : {}), ...patch });
    for (const [k, v] of [...p]) if (!v) p.delete(k);
    const s = p.toString();
    return s ? `/products?${s}` : "/products";
  };

  return (
    <div className="page">
      <PageHead
        title="Productos"
        sub={<>{fmtInt(all.length)} en el catálogo · {scope.label}{lastSync && <> · actualizado {fmtAgo(lastSync)}</>}</>}
        actions={all.length > 0 && (
          <a className="btn" href={`/api/export/products${q || f ? `?${new URLSearchParams({ ...(q ? { q: sp.q! } : {}), ...(f ? { f } : {}) })}` : ""}`}>
            <IconDownload /> Exportar CSV
          </a>
        )}
      />

      {syncError && (
        <div className="banner" data-tone="danger" role="status">
          <span>{syncError.name}: {syncError.products_sync_msg}</span>
        </div>
      )}

      <nav className="tabs" aria-label="Filtrar productos">
        {FILTERS.map((x) => (
          <Link key={x.id || "all"} href={href({ f: x.id })} aria-current={f === x.id}>
            {x.label} <span className="c">{fmtInt(counts[x.id] ?? 0)}</span>
          </Link>
        ))}
      </nav>

      <form className="toolbar" method="get" role="search">
        {f && <input type="hidden" name="f" value={f} />}
        <label className="input-icon search">
          <span className="sr-only">Buscar producto</span>
          <IconSearch />
          <input className="input" type="search" name="q" defaultValue={sp.q} placeholder="Nombre, SKU o código" />
        </label>
        <button className="btn" type="submit">Buscar</button>
        {q && <Link className="btn btn-ghost" href={href({ q: "" })}>Limpiar</Link>}
      </form>

      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty">
            <h3>{all.length === 0 ? "Aún no hay productos" : "Nada con estos filtros"}</h3>
            <p>
              {all.length === 0
                ? "El catálogo se descarga con la sincronización de tus cuentas (cada 10 minutos). También puedes sincronizar ahora desde Cuentas."
                : "Prueba con otra búsqueda o cambia de pestaña."}
            </p>
            {all.length === 0 && <Link className="btn" href="/settings">Ir a Cuentas</Link>}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table stack">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="hide-md">SKU</th>
                  <th>Estado</th>
                  <th className="r">Precio</th>
                  <th className="r">Inventario</th>
                  <th className="r hide-md" title={`Unidades en órdenes no canceladas de los últimos ${SALES_DAYS} días`}>Vendido {SALES_DAYS} d</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const sold = soldOf(p);
                  const low = p.stock !== null && p.stock <= LOW_STOCK;
                  return (
                    <tr key={p.id}>
                      <td data-slot="id">
                        <div className="product-cell">
                          {p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <span className="ph" aria-hidden><IconBox /></span>}
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
