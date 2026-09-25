import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoSelect, Drawer, DrawerClose, RowLink } from "@/components/client";
import { IconChevronLeft, IconChevronRight, IconDownload, IconExternal, IconSearch } from "@/components/icons";
import { OrderDetailView } from "@/components/order-detail";
import { PageHead, place, StatusPill } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { fmtInt, fmtMoney, fmtShort } from "@/lib/format";
import { getOrder, groupCounts, listOrders, orderFacets, PAGE_SIZE, parseFilters } from "@/lib/queries";
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

  /** URL con los filtros actuales + cambios. */
  const url = (patch: Record<string, string | number | undefined | null>) => {
    const p = new URLSearchParams();
    const merged: Record<string, unknown> = { group: f.group, q: f.q, dropshipper: f.dropshipper, carrier: f.carrier, from: f.from, to: f.to, page: f.page === 1 ? undefined : f.page, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
    const s = p.toString();
    return s ? `/orders?${s}` : "/orders";
  };
  const closeHref = url({});
  const exportHref = `/api/export?${new URLSearchParams(
    Object.entries({ group: f.group, q: f.q, dropshipper: f.dropshipper, carrier: f.carrier, from: f.from, to: f.to }).filter(([, v]) => v) as [string, string][],
  )}`;
  const hasFilters = !!(f.q || f.dropshipper || f.carrier || f.from || f.to);
  const activeGroup = groupById(f.group);

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

      <nav className="tabs" aria-label="Filtrar por estado">
        <Link href={url({ group: undefined, page: undefined })} aria-current={!activeGroup}>
          Todas <span className="c">{fmtInt(counts.all ?? 0)}</span>
        </Link>
        {GROUPS.map((g) => (
          <Link key={g.id} href={url({ group: g.id, page: undefined })} aria-current={activeGroup?.id === g.id} title={g.hint}>
            {g.label} <span className="c">{fmtInt(counts[g.id] ?? 0)}</span>
          </Link>
        ))}
      </nav>

      <form className="toolbar" method="get" role="search">
        {f.group && <input type="hidden" name="group" value={f.group} />}
        <label className="input-icon search">
          <span className="sr-only">Buscar</span>
          <IconSearch />
          <input className="input" type="search" name="q" defaultValue={f.q} placeholder="Número, cliente, teléfono, guía o ciudad" />
        </label>
        <AutoSelect name="dropshipper" defaultValue={f.dropshipper ?? ""} aria-label="Dropshipper">
          <option value="">Todos los dropshippers</option>
          {facets.dropshippers.map((d) => <option key={d} value={d}>{d}</option>)}
        </AutoSelect>
        <AutoSelect name="carrier" defaultValue={f.carrier ?? ""} aria-label="Paquetera">
          <option value="">Todas las paqueteras</option>
          {facets.carriers.map((c) => <option key={c} value={c}>{c}</option>)}
        </AutoSelect>
        <input className="input" type="date" name="from" defaultValue={f.from} aria-label="Desde" />
        <input className="input" type="date" name="to" defaultValue={f.to} aria-label="Hasta" />
        <button className="btn" type="submit">Aplicar</button>
        {hasFilters && <Link className="btn btn-ghost" href={url({ q: undefined, dropshipper: undefined, carrier: undefined, from: undefined, to: undefined, page: undefined })}>Limpiar</Link>}
      </form>

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
                    <th>Orden</th>
                    <th>Cliente</th>
                    <th className="hide-lg">Productos</th>
                    <th className="hide-md hide-l">Dropshipper</th>
                    <th className="hide-xl">Paquetera</th>
                    <th>Estado</th>
                    <th className="r">Total</th>
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
