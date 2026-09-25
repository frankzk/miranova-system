import Link from "next/link";
import { requireLogin } from "@/lib/auth";
import { filterOptions, lastIngest, listOrders, PAGE_SIZE, parseFilters, todayStats } from "@/lib/queries";
import { fmtDate, fmtMoney, todayHN } from "@/lib/format";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function Dashboard({ searchParams }: { searchParams: SP }) {
  await requireLogin();
  const sp = await searchParams;
  const f = parseFilters(sp);
  const today = todayHN();

  const [{ orders, count }, opts, stats, last] = await Promise.all([
    listOrders(f),
    filterOptions(),
    todayStats(today),
    lastIngest(),
  ]);

  const page = f.page ?? 1;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const qs = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...extra })) if (v !== undefined && v !== "") p.set(k, String(v));
    return p.toString();
  };
  const exportQs = qs({ page: "" });
  const reprocessed = typeof sp.reprocessed === "string" ? sp.reprocessed : null;

  return (
    <main className="wrap">
      <div className="top">
        <div>
          <h1>Pedidos Drop</h1>
          <div className="sub">
            {last
              ? `Última captura: ${fmtDate(last.received_at)} (${last.source}, ${last.orders_found} pedidos)`
              : "Aún no se ha recibido ninguna captura"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="btn primary" href={`/api/export?${exportQs}`}>Exportar CSV</a>
          <form method="post" action="/api/reprocess">
            <button className="btn" type="submit" title="Vuelve a leer los datos originales con el mapeo actual">
              Re-procesar
            </button>
          </form>
          <form method="post" action="/api/logout">
            <button className="btn" type="submit">Salir</button>
          </form>
        </div>
      </div>

      {reprocessed && <div className="notice">Se re-procesaron {reprocessed} pedidos.</div>}

      <section className="stats">
        <div className="card stat"><div className="label">Pedidos hoy</div><div className="value">{stats.count}</div></div>
        <div className="card stat"><div className="label">Pendientes hoy</div><div className="value">{stats.pending}</div></div>
        <div className="card stat"><div className="label">Vendido hoy</div><div className="value">{fmtMoney(stats.sum)}</div></div>
        <div className="card stat"><div className="label">Resultados del filtro</div><div className="value">{count}</div></div>
      </section>

      <form className="card filters" method="get">
        <label className="grow">
          Buscar
          <input name="q" defaultValue={f.q} placeholder="# orden, cliente, teléfono, ciudad…" />
        </label>
        <label>
          Estado
          <select name="status" defaultValue={f.status ?? ""}>
            <option value="">Todos</option>
            {opts.statuses.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Dropshipper
          <select name="dropshipper" defaultValue={f.dropshipper ?? ""}>
            <option value="">Todos</option>
            {opts.dropshippers.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Paquetera
          <select name="carrier" defaultValue={f.carrier ?? ""}>
            <option value="">Todas</option>
            {opts.carriers.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label>Desde<input type="date" name="from" defaultValue={f.from} /></label>
        <label>Hasta<input type="date" name="to" defaultValue={f.to} /></label>
        <button className="btn primary" type="submit">Filtrar</button>
        <Link className="btn" href={`/?from=${today}&to=${today}`}>Hoy</Link>
        <Link className="btn" href="/">Limpiar</Link>
      </form>

      <section className="card">
        {orders.length === 0 ? (
          <div className="empty">
            {count === 0 && !last ? (
              <>
                <strong>Todavía no hay pedidos.</strong>
                <ol>
                  <li>Instala la extensión de Chrome (carpeta <code>extension/</code>).</li>
                  <li>En sus opciones pon la URL de este panel y tu <code>INGEST_API_KEY</code>.</li>
                  <li>Abre <code>app.soydrop.com/vendor/orders</code>: los pedidos aparecerán aquí.</li>
                </ol>
              </>
            ) : (
              "No hay pedidos con estos filtros."
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Orden de drop</th>
                  <th className="hide-sm">Orden Shopify</th>
                  <th>Dropshipper</th>
                  <th>Cliente</th>
                  <th className="hide-sm">Destino</th>
                  <th>Productos</th>
                  <th>Paquetera</th>
                  <th>Total</th>
                  <th>Creación</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td><Link className="mono" href={`/orders/${o.id}`}>#{o.external_id}</Link></td>
                    <td className="hide-sm">{o.shopify_order ?? "—"}</td>
                    <td>{o.dropshipper ?? "—"}</td>
                    <td>
                      {o.customer_name ?? "—"}
                      {o.customer_phone && <div className="small">{o.customer_phone}</div>}
                    </td>
                    <td className="hide-sm">
                      {[o.city, o.department].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td>
                      {o.order_items.length === 0 ? (
                        <span className="small">Abre el detalle en Drop para capturarlos</span>
                      ) : (
                        o.order_items.map((it, i) => (
                          <div key={i} className="small">{it.quantity} × {it.product_name}</div>
                        ))
                      )}
                    </td>
                    <td>{o.carrier ?? "—"}</td>
                    <td className="num">{fmtMoney(o.total, o.currency ?? "HNL")}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(o.ordered_at) || "—"}</td>
                    <td>
                      {o.status && (
                        <span className={`chip ${/pendiente|pending/i.test(o.status) ? "pending" : ""}`}>{o.status}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {count > 0 && (
          <div className="pager">
            <span>Página {page} de {pages} · {count} pedidos</span>
            <span style={{ display: "flex", gap: 8 }}>
              {page > 1 && <Link className="btn" href={`/?${qs({ page: page - 1 })}`}>← Anterior</Link>}
              {page < pages && <Link className="btn" href={`/?${qs({ page: page + 1 })}`}>Siguiente →</Link>}
            </span>
          </div>
        )}
      </section>
    </main>
  );
}
