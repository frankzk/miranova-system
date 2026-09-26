import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoSelect, Drawer, DrawerClose, GetForm, RowLink } from "@/components/client";
import { ColumnFilter, type FilterOption } from "@/components/column-filter";
import { IconChevronLeft, IconChevronRight, IconClose, IconDownload, IconExternal, IconFilter, IconSearch } from "@/components/icons";
import { OrderDetailView } from "@/components/order-detail";
import { AccountChips } from "@/components/account-chips";
import { PageHead, place, StatusPill } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { fmtInt, fmtMoney, fmtShort } from "@/lib/format";
import { getOrder, groupCounts, listOrders, orderFacets, PAGE_SIZE, parseFilters, SORTS, type Sort } from "@/lib/queries";
import { getScope } from "@/lib/scope";
import { GROUPS, groupById } from "@/lib/status";

export const metadata = { title: "Órdenes" };

type SP = Record<string, string | string[] | undefined>;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const accounts = await listAccounts();
  const scope = await getScope(accounts);
  const f = { ...parseFilters(sp), account: scope.account };
  const openId = typeof sp.order === "string" ? sp.order : null;
  if (openId && !/^[0-9a-f-]{36}$/i.test(openId)) notFound();

  const [{ orders, count }, counts, facets, open] = await Promise.all([
    listOrders(f),
    groupCounts({ ...f, group: undefined }),
    orderFacets(scope.account),
    openId ? getOrder(openId) : Promise.resolve(null),
  ]);

  const page = f.page ?? 1;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const showAccount = !scope.account && accounts.length > 1;

  const current = { group: f.group, q: f.q, status: f.status, dept: f.dept, product: f.product, dropshipper: f.dropshipper, carrier: f.carrier, from: f.from, to: f.to, sort: f.sort };
  const params = (patch: Record<string, string | number | undefined | null>) => {
    const p = new URLSearchParams();
    const merged: Record<string, unknown> = { ...current, page: f.page === 1 ? undefined : f.page, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
    return p.toString();
  };
  /** URL con los filtros actuales + cambios. */
  const url = (patch: Record<string, string | number | undefined | null>) => {
    const s = params(patch);
    return s ? `/orders?${s}` : "/orders";
  };
  /** Query base de cada filtro de columna: sin ese filtro ni la página. */
  const without = (key: string) => params({ [key]: undefined, page: undefined });
  const closeHref = url({});
  const exportHref = `/api/export?${params({ page: undefined, group: f.group })}`;
  const activeGroup = groupById(f.group);

  const statusOpts: FilterOption[] = facets.statuses
    .filter((x) => !activeGroup || x.group === activeGroup.id)
    .map((x) => ({ value: x.code, label: x.label ?? x.code, count: x.n }));
  const statusLabel = (code: string) => facets.statuses.find((x) => x.code === code)?.label ?? code;
  const deptOpts: FilterOption[] = facets.departments.map((d) => ({ value: d.name, label: d.name, count: d.n }));
  const productOpts: FilterOption[] = facets.products.map((d) => ({ value: d.name, label: d.name, count: d.n }));
  const plain = (xs: string[]): FilterOption[] => xs.map((x) => ({ value: x, label: x }));
  const sortOpts = (keys: Sort[]): FilterOption[] => keys.map((k) => ({ value: k, label: SORTS[k].label }));

  // filtros aplicados, para mostrarlos como chips que se pueden quitar
  const applied = [
    f.status && { key: "status", label: `Estado: ${statusLabel(f.status)}` },
    f.dept && { key: "dept", label: `Departamento: ${f.dept}` },
    f.product && { key: "product", label: `Producto: ${f.product}` },
    f.dropshipper && { key: "dropshipper", label: `Dropshipper: ${f.dropshipper}` },
    f.carrier && { key: "carrier", label: `Paquetera: ${f.carrier}` },
    f.sort && { key: "sort", label: `Orden: ${SORTS[f.sort].label}` },
  ].filter(Boolean) as { key: string; label: string }[];
  const hasFilters = !!(f.q || f.from || f.to || applied.length);

  return (
    <div className="page">
      <PageHead
        title="Órdenes"
        sub={<>{fmtInt(counts.all ?? 0)} órdenes · {scope.label}</>}
        actions={
          <a className="btn" href={exportHref}>
            <IconDownload /> Exportar CSV
          </a>
        }
      />

      <AccountChips accounts={accounts} current={scope.account} next={url({ page: undefined })} />

      <nav className="tabs" aria-label="Filtrar por estado">
        <Link href={url({ group: undefined, status: undefined, page: undefined })} aria-current={!activeGroup}>
          Todas <span className="c">{fmtInt(counts.all ?? 0)}</span>
        </Link>
        {GROUPS.map((g) => (
          <Link key={g.id} href={url({ group: g.id, status: undefined, page: undefined })} aria-current={activeGroup?.id === g.id} title={g.hint}>
            {g.label} <span className="c">{fmtInt(counts[g.id] ?? 0)}</span>
          </Link>
        ))}
      </nav>

      <GetForm className="toolbar" role="search">
        {f.group && <input type="hidden" name="group" value={f.group} />}
        <label className="input-icon search">
          <span className="sr-only">Buscar</span>
          <IconSearch />
          <input className="input" type="search" name="q" defaultValue={f.q} placeholder="Número, cliente, teléfono, guía o ciudad" />
        </label>
        <input className="input" type="date" name="from" defaultValue={f.from} aria-label="Desde" />
        <input className="input" type="date" name="to" defaultValue={f.to} aria-label="Hasta" />
        <button className="btn" type="submit">Aplicar</button>
        <details className="more-filters">
          <summary className="btn">
            <IconFilter /> Filtros{applied.length > 0 && <span className="c">{applied.length}</span>}
          </summary>
          <div className="more-panel">
            <FilterSelect name="status" label="Estado" value={f.status} all="Todos los estados" options={statusOpts} />
            <FilterSelect name="dept" label="Departamento" value={f.dept} all="Todos los departamentos" options={deptOpts} />
            <FilterSelect name="product" label="Producto" value={f.product} all="Todos los productos" options={productOpts} />
            <FilterSelect name="dropshipper" label="Dropshipper" value={f.dropshipper} all="Todos los dropshippers" options={plain(facets.dropshippers)} />
            <FilterSelect name="carrier" label="Paquetera" value={f.carrier} all="Todas las paqueteras" options={plain(facets.carriers)} />
            <FilterSelect name="sort" label="Ordenar por" value={f.sort} all={SORTS.recent.label} options={sortOpts(["old", "total_desc", "total_asc"])} />
          </div>
        </details>
        {hasFilters && <Link className="btn btn-ghost" href={url({ q: undefined, status: undefined, dept: undefined, product: undefined, dropshipper: undefined, carrier: undefined, from: undefined, to: undefined, sort: undefined, page: undefined })}>Limpiar</Link>}
      </GetForm>

      {applied.length > 0 && (
        <div className="applied" aria-label="Filtros aplicados">
          {applied.map((a) => (
            <Link key={a.key} href={url({ [a.key]: undefined, page: undefined })} aria-label={`Quitar ${a.label}`}>
              {a.label} <IconClose />
            </Link>
          ))}
        </div>
      )}

      <div className="table-wrap">
        {orders.length === 0 ? (
          <div className="empty">
            <h3>{hasFilters || activeGroup ? "Nada con estos filtros" : "Aún no hay órdenes"}</h3>
            <p>
              {hasFilters || activeGroup
                ? "Prueba con otra búsqueda, quita algún filtro o cambia de pestaña."
                : "Cuando tus cuentas sincronicen, las órdenes aparecerán aquí automáticamente."}
            </p>
            {(hasFilters || activeGroup) && <Link className="btn" href="/orders">Ver todas las órdenes</Link>}
          </div>
        ) : (
          <>
            <div className="table-scroll">
              <table className="table stack">
                <thead>
                  <tr>
                    <th><ColumnFilter label="Orden" param="sort" query={without("sort")} current={f.sort === "old" ? "old" : undefined} allLabel={SORTS.recent.label} options={sortOpts(["old"])} title="Ordenar por fecha" /></th>
                    <th><ColumnFilter label="Cliente" param="dept" query={without("dept")} current={f.dept} allLabel="Todos los departamentos" options={deptOpts} title="Filtrar por departamento" /></th>
                    <th className="hide-lg"><ColumnFilter label="Productos" param="product" query={without("product")} current={f.product} allLabel="Todos los productos" options={productOpts} title="Órdenes que contienen un producto" /></th>
                    <th className="hide-md hide-l"><ColumnFilter label="Dropshipper" param="dropshipper" query={without("dropshipper")} current={f.dropshipper} allLabel="Todos los dropshippers" options={plain(facets.dropshippers)} /></th>
                    <th className="hide-xl"><ColumnFilter label="Paquetera" param="carrier" query={without("carrier")} current={f.carrier} allLabel="Todas las paqueteras" options={plain(facets.carriers)} /></th>
                    <th><ColumnFilter label="Estado" param="status" query={without("status")} current={f.status} allLabel={activeGroup ? `Todos: ${activeGroup.label.toLowerCase()}` : "Todos los estados"} options={statusOpts} title="Estado exacto" /></th>
                    <th className="r"><ColumnFilter label="Total" param="sort" align="right" query={without("sort")} current={f.sort?.startsWith("total") ? f.sort : undefined} allLabel="Por fecha" options={sortOpts(["total_desc", "total_asc"])} title="Ordenar por total" /></th>
                    <th className="r hide-md">Te toca</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const first = o.order_items[0];
                    const more = o.order_items.length - 1;
                    return (
                      <RowLink key={o.id} href={url({ order: o.id })} selected={o.id === openId}>
                        <td data-slot="id">
                          <Link className="order-no" href={url({ order: o.id })} scroll={false}>#{o.external_id}</Link>
                          <div className="sub nowrap">{fmtShort(o.ordered_at, o.accounts?.timezone)}</div>
                          {showAccount && o.accounts && <div className="sub nowrap">{o.accounts.name}</div>}
                        </td>
                        <td data-slot="customer">
                          <div className="strong clip" style={{ maxWidth: 200 }}>{o.customer_name ?? "—"}</div>
                          <div className="sub clip" style={{ maxWidth: 200 }}>{place(o.city, o.department) || o.customer_phone || ""}</div>
                        </td>
                        <td className="hide-lg hide-sm">
                          {first ? (
                            <>
                              <div className="clip" style={{ maxWidth: 200 }} title={first.product_name}>{first.quantity} × {first.product_name}</div>
                              {more > 0 && <div className="sub">+{more} producto{more > 1 ? "s" : ""}</div>}
                            </>
                          ) : <span className="subtle">—</span>}
                        </td>
                        <td className="hide-md hide-l hide-sm"><div className="clip" style={{ maxWidth: 140 }}>{o.dropshipper ?? "—"}</div></td>
                        <td className="hide-xl hide-sm nowrap">{o.carrier ?? "—"}</td>
                        <td data-slot="status"><StatusPill code={o.status_code} label={o.status} /></td>
                        <td data-slot="total" className="num strong">{fmtMoney(o.total, o.currency ?? "HNL")}</td>
                        <td className="num hide-md hide-sm">{fmtMoney(o.vendor_amount, o.currency ?? "HNL")}</td>
                      </RowLink>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <span className="tabular">
                {fmtInt((page - 1) * PAGE_SIZE + 1)}–{fmtInt(Math.min(page * PAGE_SIZE, count))} de {fmtInt(count)}
              </span>
              <span className="btns">
                {page > 1 ? (
                  <Link className="btn btn-sm" href={url({ page: page - 1 })} aria-label="Página anterior"><IconChevronLeft /> Anterior</Link>
                ) : (
                  <span className="btn btn-sm" aria-disabled="true"><IconChevronLeft /> Anterior</span>
                )}
                {page < pages ? (
                  <Link className="btn btn-sm" href={url({ page: page + 1 })} aria-label="Página siguiente">Siguiente <IconChevronRight /></Link>
                ) : (
                  <span className="btn btn-sm" aria-disabled="true">Siguiente <IconChevronRight /></span>
                )}
              </span>
            </div>
          </>
        )}
      </div>

      {open && (
        <Drawer closeHref={closeHref} label={`Orden ${open.external_id}`}>
          <OrderDetailView
            o={open}
            headControls={
              <div style={{ display: "flex", gap: 4 }}>
                <Link className="btn btn-ghost btn-icon" href={`/orders/${open.id}`} aria-label="Abrir en página completa" title="Abrir en página completa">
                  <IconExternal />
                </Link>
                <DrawerClose href={closeHref} />
              </div>
            }
          />
        </Drawer>
      )}
    </div>
  );
}

function FilterSelect({ name, label, value, all, options }: { name: string; label: string; value?: string; all: string; options: FilterOption[] }) {
  return (
    <label className="field">
      <span>{label}</span>
      <AutoSelect name={name} defaultValue={value ?? ""}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}{o.count !== undefined ? ` (${o.count.toLocaleString("en-US")})` : ""}</option>
        ))}
      </AutoSelect>
    </label>
  );
}
