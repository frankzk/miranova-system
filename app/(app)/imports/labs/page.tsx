import Link from "next/link";
import { IconDownload, IconPlus, IconSearch } from "@/components/icons";
import { ImportsSubnav } from "@/components/imports-subnav";
import { DeleteLabForm, LabForm, LabStatusSelect } from "@/components/lab-forms";
import { SideSheet } from "@/components/side-sheet";
import { PageHead } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { fmtInt, todayIn } from "@/lib/format";
import { inLabView, LAB_DESTINATIONS, LAB_VIEWS, labTotals, matchesLab } from "@/lib/lab-purchases";
import { defaultGtqRate, listLabPurchases } from "@/lib/lab-purchases-data";
import { can } from "@/lib/permissions";
import { listProducts } from "@/lib/queries";
import { deleteLabPurchase, saveLabPurchase, setLabStatus } from "./actions";
import "../imports.css";
import "../../requests/requests.css";
import "./labs.css";

export const metadata = { title: "Laboratorios" };

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};

/** "15 oct" de un día "YYYY-MM-DD" (con el año si no es el actual). */
const day = (ymd: string, today: string) =>
  new Intl.DateTimeFormat("es-HN", { timeZone: "UTC", day: "numeric", month: "short", ...(ymd.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }) })
    .format(new Date(`${ymd}T12:00:00Z`))
    .replace(/\./g, "");
const money2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function LabsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [user, all, fx, catalog, sp] = await Promise.all([
    requirePermission("imports"),
    listLabPurchases(),
    defaultGtqRate().catch(() => 7.75),
    listProducts().catch((e) => (console.error("laboratorios: productos", e), [])),
    searchParams,
  ]);
  const money = can(user, "money");
  const today = todayIn();
  const view = LAB_VIEWS.find((v) => v.id === one(sp, "v")) ?? LAB_VIEWS[0];
  const q = one(sp, "q")?.slice(0, 120);
  const rows = all.filter((r) => inLabView(r, view) && matchesLab(r, q));
  const active = all.filter((r) => inLabView(r, LAB_VIEWS[0]));
  const activeUnits = active.reduce((t, r) => t + labTotals(r).total, 0);
  const activeGtq = active.reduce((t, r) => t + (labTotals(r).amount_gtq ?? 0), 0);
  const unique = (xs: (string | null)[]) => [...new Map(xs.filter((x): x is string => !!x?.trim()).map((x) => [x.trim().toLowerCase(), x.trim()])).values()];
  const labs = unique(all.map((r) => r.lab_name));
  const products = unique([...all.map((r) => r.product), ...catalog.map((p) => p.name)]);

  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { v: view.id === "activas" ? undefined : view.id, q, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/imports/labs?${s}` : "/imports/labs";
  };
  const form = (v?: Parameters<typeof LabForm>[0]["v"]) => (
    <LabForm action={saveLabPurchase} v={v} today={today} money={money} defaultFx={fx} labs={labs} products={products} />
  );

  return (
    <div className="page im-page lab-page">
      <PageHead
        title="Laboratorios"
        sub={<>
          {fmtInt(active.length)} en curso
          {active.length > 0 && <> · {fmtInt(activeUnits)} unidades</>}
          {money && activeGtq > 0 && <> · Q{money2(activeGtq)}</>}
          {" "}· compras locales a laboratorios y su reparto por cuenta
        </>}
        actions={
          <>
            {can(user, "export") && all.length > 0 && (
              <a className="btn" href={`/api/export/labs?${new URLSearchParams({ v: view.id, ...(q ? { q } : {}) })}`} download title="Descargar en Excel (.xlsx), con los filtros aplicados">
                <IconDownload /> Descargar Excel
              </a>
            )}
            <SideSheet trigger={<><IconPlus /> Nueva compra</>} triggerClass="btn btn-primary" title="Nueva compra a laboratorio" sub="Producto, cantidades, reparto por cuenta y fechas">
              {form()}
            </SideSheet>
          </>
        }
      />
      <ImportsSubnav money={money} />

      <div className="rq-filters">
        <nav className="tabs lab-tabs" aria-label="Compras a laboratorios">
          {LAB_VIEWS.map((v) => (
            <Link key={v.id} href={href({ v: v.id === "activas" ? undefined : v.id })} aria-current={view.id === v.id}>
              {v.label} <span className="c">{fmtInt(all.filter((r) => inLabView(r, v) && matchesLab(r, q)).length)}</span>
            </Link>
          ))}
        </nav>
        <form className="rq-search" action="/imports/labs" role="search">
          {view.id !== "activas" && <input type="hidden" name="v" value={view.id} />}
          <label className="input-icon">
            <IconSearch />
            <input className="input" type="search" name="q" defaultValue={q} placeholder="Producto o laboratorio" aria-label="Buscar compras" />
          </label>
        </form>
      </div>

      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty">
            <h3>{all.length ? "Nada con estos filtros" : "Aún no hay compras a laboratorios"}</h3>
            <p>
              {all.length
                ? "Cambia de pestaña o la búsqueda."
                : "Registra cada compra con “Nueva compra”: producto, cantidad solicitada y cortesía, cómo se reparte entre Miranova, Mireva y Dropi, fechas y precio en quetzales."}
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table stack im-table lab-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Estado</th>
                  <th>Fechas</th>
                  <th className="r">Cantidad</th>
                  <th>Reparto</th>
                  {money && <th className="r">Monto</th>}
                  <th><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const t = labTotals(r);
                  const parts = LAB_DESTINATIONS.filter((d) => (r.distribution[d.id] ?? 0) > 0);
                  return (
                    <tr key={r.id}>
                      <td data-slot="id">
                        <div className="strong">{r.product}</div>
                        <div className="sub">
                          {r.lab_name ?? "Laboratorio sin indicar"}
                          {r.boxes !== null && <> · {fmtInt(r.boxes)} {r.boxes === 1 ? "caja" : "cajas"}</>}
                        </div>
                        {r.notes && <div className="sub rq-notes" title={r.notes}>{r.notes}</div>}
                      </td>
                      <td data-slot="status">
                        <LabStatusSelect key={`${r.id}-${r.status}`} action={setLabStatus} id={r.id} status={r.status} />
                      </td>
                      <td className="nowrap lab-dates">
                        <div><span className="k">Solicitud</span> {day(r.requested_at, today)}</div>
                        <div><span className="k">Traslado</span> {r.shipped_at ? day(r.shipped_at, today) : <span className="subtle">—</span>}</div>
                        <div><span className="k">Llega a Drop</span> {r.arrived_at ? day(r.arrived_at, today) : <span className="subtle">—</span>}</div>
                      </td>
                      <td className="num">
                        <span className="strong">{fmtInt(t.total)}</span>
                        <div className="sub">{fmtInt(r.qty_requested)} solicitadas{r.qty_courtesy > 0 && <> + {fmtInt(r.qty_courtesy)} cortesía</>}</div>
                      </td>
                      <td>
                        {parts.length > 0 ? (
                          <ul className="lab-parts">
                            {parts.map((d) => <li key={d.id}><span>{d.label}</span> <b>{fmtInt(r.distribution[d.id] ?? 0)}</b></li>)}
                          </ul>
                        ) : (
                          <span className="subtle">Sin repartir</span>
                        )}
                        <div className={`sub${t.pending !== 0 ? " im-warn-text" : ""}`}>
                          {fmtInt(t.distributed)} distribuidas{t.pending > 0 && <> · faltan {fmtInt(t.pending)}</>}
                        </div>
                      </td>
                      {money && (
                        <td className="num nowrap">
                          {t.amount_gtq === null ? <span className="subtle">—</span> : <span className="strong">Q{money2(t.amount_gtq)}</span>}
                          {t.amount_usd !== null && <div className="sub">${money2(t.amount_usd)}</div>}
                          {r.unit_price_gtq !== null && <div className="sub">Q{money2(r.unit_price_gtq)} c/u</div>}
                        </td>
                      )}
                      <td className="r nowrap">
                        <SideSheet trigger="Editar" triggerClass="btn btn-ghost btn-sm" title={r.product} sub={`Compra del ${day(r.requested_at, today)}`}>
                          {form(r)}
                          <div className="section im-recv-photos">
                            <DeleteLabForm action={deleteLabPurchase} id={r.id} label={r.product} />
                          </div>
                        </SideSheet>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="footnote">
        El monto es precio por unidad × cantidad solicitada (la cortesía no se cobra); en dólares, con el tipo de cambio de cada compra
        {money && <> (para una nueva se sugiere el de Drop Guatemala: Q{fx.toFixed(2)} por dólar)</>}.
      </p>
    </div>
  );
}
