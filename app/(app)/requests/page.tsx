import Link from "next/link";
import { IconDownload, IconPlus, IconSearch } from "@/components/icons";
import { DeleteRequestForm, RequestForm, RequestStatusSelect } from "@/components/request-forms";
import { SideSheet } from "@/components/side-sheet";
import { PageHead } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { countryByCode } from "@/lib/countries";
import { fmtAgo, fmtInt, todayIn } from "@/lib/format";
import { can } from "@/lib/permissions";
import { demandByProduct, filterRequests, inScope, inView, isOverdue, parseRequestFilters, REQUEST_VIEWS } from "@/lib/store-requests";
import { listRequests, requestCountries, requestFormOptions } from "@/lib/store-requests-data";
import { deleteRequest, saveRequest, setRequestStatus } from "./actions";
import "../imports/imports.css";
import "./requests.css";

export const metadata = { title: "Solicitudes" };

type SP = Record<string, string | string[] | undefined>;

/** "15 oct" de un día "YYYY-MM-DD" (con el año si no es el actual). */
const day = (ymd: string, today: string) =>
  new Intl.DateTimeFormat("es-HN", { timeZone: "UTC", day: "numeric", month: "short", ...(ymd.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }) })
    .format(new Date(`${ymd}T12:00:00Z`))
    .replace(/\./g, "");

const TOP = 8;

export default async function RequestsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [user, all, countries, sp] = await Promise.all([requirePermission("requests"), listRequests(), requestCountries(), searchParams]);
  const options = await requestFormOptions(all);
  const f = parseRequestFilters(sp);
  const rows = filterRequests(all, f);
  const codes = countries.map((c) => c.code);
  const countryName = (c: string) => countryByCode(c)?.name ?? c;
  const countryList = (cs: string[]) => (codes.length > 1 && codes.every((c) => cs.includes(c)) ? `Los ${codes.length} países` : cs.map(countryName).join(", "));
  const demand = demandByProduct(rows, codes);
  const units = rows.reduce((t, r) => t + r.quantity, 0);
  const open = all.filter((r) => inView(r, REQUEST_VIEWS[0]));
  const today = todayIn();
  const overdue = open.filter((r) => isOverdue(r, today)).length;

  const query = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { v: f.view.id === "abiertas" ? undefined : f.view.id, c: f.country, q: f.q, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return p.toString();
  };
  const href = (patch: Record<string, string | undefined>) => {
    const s = query(patch);
    return s ? `/requests?${s}` : "/requests";
  };
  const exportHref = `/api/export/requests?${query({ v: f.view.id })}`;
  const form = (v?: Parameters<typeof RequestForm>[0]["v"]) => (
    <RequestForm action={saveRequest} v={v} countries={countries} stores={options.stores} products={options.products} today={today} />
  );

  return (
    <div className="page im-page rq-page">
      <PageHead
        title="Solicitudes"
        sub={<>
          {fmtInt(open.length)} {open.length === 1 ? "abierta" : "abiertas"}
          {open.length > 0 && <> · {fmtInt(open.reduce((t, r) => t + r.quantity, 0))} unidades pedidas</>}
          {overdue > 0 && <> · <span className="im-alert-text">{overdue} con la fecha de llegada vencida</span></>}
          {" "}· lo que piden las tiendas, para decidir qué traer
        </>}
        actions={
          <>
            {can(user, "export") && all.length > 0 && (
              <a className="btn" href={exportHref} download title="Descargar en Excel (.xlsx), con los filtros aplicados">
                <IconDownload /> Descargar Excel
              </a>
            )}
            <SideSheet trigger={<><IconPlus /> Nueva solicitud</>} triggerClass="btn btn-primary" title="Nueva solicitud" sub="Qué pide la tienda, cuánto y para qué países">
              {form()}
            </SideSheet>
          </>
        }
      />

      <nav className="tabs" aria-label="Solicitudes">
        {REQUEST_VIEWS.map((v) => (
          <Link key={v.id} href={href({ v: v.id === "abiertas" ? undefined : v.id })} aria-current={f.view.id === v.id}>
            {v.label} <span className="c">{fmtInt(all.filter((r) => inView(r, v) && inScope(r, f)).length)}</span>
          </Link>
        ))}
      </nav>

      <div className="rq-filters">
        {codes.length > 1 && (
          <nav className="chips" aria-label="País">
            <Link href={href({ c: undefined })} aria-current={!f.country}>Todos los países</Link>
            {countries.map((c) => <Link key={c.code} href={href({ c: c.code })} aria-current={f.country === c.code}>{c.name}</Link>)}
          </nav>
        )}
        <form className="rq-search" action="/requests" role="search">
          {f.view.id !== "abiertas" && <input type="hidden" name="v" value={f.view.id} />}
          {f.country && <input type="hidden" name="c" value={f.country} />}
          <label className="input-icon">
            <IconSearch />
            <input className="input" type="search" name="q" defaultValue={f.q} placeholder="Tienda, dueño o producto" aria-label="Buscar solicitudes" />
          </label>
        </form>
      </div>

      {demand.length > 0 && (
        <section className="panel rq-demand" aria-labelledby="rq-demand-h">
          <div className="panel-head">
            <h2 id="rq-demand-h">Lo más pedido</h2>
            <span className="aside">{fmtInt(units)} unidades en {fmtInt(rows.length)} {rows.length === 1 ? "solicitud" : "solicitudes"} · {f.view.label.toLowerCase()}</span>
          </div>
          <ol className="rq-demand-list">
            {demand.slice(0, TOP).map((d) => (
              <li key={d.product}>
                <span className="rq-d-name" title={d.product}>{d.product}</span>
                <span className="rq-d-units"><b>{fmtInt(d.units)}</b> u.</span>
                <span className="rq-d-meta">
                  {d.stores} {d.stores === 1 ? "tienda" : "tiendas"} · {countryList(d.countries)}
                </span>
              </li>
            ))}
          </ol>
          {demand.length > TOP && <p className="panel-note subtle">Y {demand.length - TOP} productos más en la lista.</p>}
        </section>
      )}

      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty">
            <h3>{all.length ? "Nada con estos filtros" : "Aún no hay solicitudes"}</h3>
            <p>
              {all.length
                ? "Cambia de pestaña, de país o la búsqueda."
                : "Cuando una tienda pida algo (p. ej. 500 drenajes en gotas para Honduras), anótalo con “Nueva solicitud”: tienda, dueño, países, productos con su cantidad y fechas."}
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table stack im-table rq-table">
              <thead>
                <tr>
                  <th>Tienda</th>
                  <th>Producto</th>
                  <th className="r">Cantidad</th>
                  <th>Países</th>
                  <th>Estado</th>
                  <th className="nowrap">Solicitud</th>
                  <th className="nowrap">Llegada</th>
                  <th><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-slot="id">
                      <div className="strong">{r.store_name}</div>
                      <div className="sub">{r.owner_name ?? "Dueño sin indicar"}</div>
                    </td>
                    <td>
                      {r.items.length > 1 ? (
                        <ul className="rq-items" aria-label="Productos">
                          {r.items.map((it, i) => <li key={i}><span className="q">{fmtInt(it.quantity)}</span><span>{it.product}</span></li>)}
                        </ul>
                      ) : (
                        <div>{r.items[0]?.product ?? r.product}</div>
                      )}
                      {r.notes && <div className="sub rq-notes" title={r.notes}>{r.notes}</div>}
                    </td>
                    <td className="num">
                      <span className="strong">{fmtInt(r.quantity)}</span>
                      {r.items.length > 1 && <div className="sub">{r.items.length} productos</div>}
                    </td>
                    <td className="rq-countries-cell">
                      {countryList(r.countries)}
                      {r.origin_country && <div className="sub">Origen: {r.origin_country}</div>}
                    </td>
                    <td data-slot="status">
                      <RequestStatusSelect key={`${r.id}-${r.status}`} action={setRequestStatus} id={r.id} status={r.status} />
                    </td>
                    <td className="nowrap" data-label="Solicitud">
                      {day(r.requested_at, today)}
                      <div className="sub">{r.created_by_name ? `cargada por ${r.created_by_name.split(" ")[0]}` : fmtAgo(r.created_at)}</div>
                    </td>
                    <td className="nowrap" data-label="Llegada">
                      {r.arrival_at ? (
                        isOverdue(r, today) ? <span className="im-alert-text" title="La solicitud sigue abierta y la fecha de llegada ya pasó">{day(r.arrival_at, today)} · vencida</span> : day(r.arrival_at, today)
                      ) : (
                        <span className="subtle">—</span>
                      )}
                    </td>
                    <td className="r nowrap">
                      <SideSheet trigger="Editar" triggerClass="btn btn-ghost btn-sm" title={r.store_name} sub={`Solicitud del ${day(r.requested_at, today)}`}>
                        {form(r)}
                        <div className="section im-recv-photos">
                          <DeleteRequestForm action={deleteRequest} id={r.id} label={r.store_name} />
                        </div>
                      </SideSheet>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
