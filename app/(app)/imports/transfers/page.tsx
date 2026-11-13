import Link from "next/link";
import { RowLink } from "@/components/client";
import { IconCheck, IconPlus } from "@/components/icons";
import { ImportsSubnav } from "@/components/imports-subnav";
import { SideSheet } from "@/components/side-sheet";
import { BuildTransferForm, NewTransferForm, SettleForm } from "@/components/transfer-forms";
import { PageHead } from "@/components/ui";
import { requireAnyPermission } from "@/lib/auth";
import { COUNTRIES, countryByCode } from "@/lib/countries";
import { fmtInt, todayIn } from "@/lib/format";
import { can } from "@/lib/permissions";
import { byDestination, hasIssues, isLate, lineLabel, routeSummary, totals, transferStatus, TRANSFER_STATUSES, type TransferFull } from "@/lib/transfers";
import { documentKinds, listPending, listPoints, listTransfers } from "@/lib/transfers-data";
import { buildTransfer, createTransfer, settlePending } from "./actions";
import "../imports.css";
import "./transfers.css";

export const metadata = { title: "Traslados" };

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};

// pestaña "En ruta": lo que ya salió (lo que se prepara va en "Por enviar")
const VIEWS = [
  { id: "camino", label: "En camino", test: (t: TransferFull) => t.status === "transit" },
  { id: "llegaron", label: "Llegaron", test: (t: TransferFull) => t.status === "arrived" },
  { id: "cancelados", label: "Cancelados", test: (t: TransferFull) => t.status === "cancelled" },
  { id: "todos", label: "Todos", test: () => true },
] as const;

/** "14 oct" */
const shortDay = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("es-HN", { day: "numeric", month: "short", timeZone: "UTC" }).replace(/\./g, "") : "—");

export default async function TransfersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [user, points, transfers, docs, sp] = await Promise.all([requireAnyPermission("imports", "imports_view"), listPoints(), listTransfers(), documentKinds(), searchParams]);
  // "Compras (solo ver)": sin crear ni armar, y sin los repartos (son de Solicitudes y Laboratorios)
  const edit = can(user, "imports");
  const pending = edit ? await listPending(transfers, points) : [];
  const money = can(user, "money");
  const today = todayIn();
  const pointOf = new Map(points.map((p) => [p.id, p]));
  const pointName = (id: string) => pointOf.get(id)?.name ?? "Bodega borrada";
  const countryName = (c: string) => countryByCode(c)?.name ?? c;
  const countries = COUNTRIES.map((c) => ({ code: c.code, name: c.name }));

  // dos pestañas: "En ruta" (lo que salió) y "Por enviar" (lo armado que no sale y los repartos pendientes)
  const tab = one(sp, "s") === "enviar" ? "enviar" : "ruta";
  const defaultView = "camino";
  const view = VIEWS.find((v) => v.id === (one(sp, "v") ?? defaultView)) ?? VIEWS[0];
  const country = one(sp, "c");
  const inScope = (t: TransferFull) => !country || t.dest_country === country;
  const rows = transfers.filter((t) => view.test(t) && inScope(t));
  const usedCountries = [...new Set(transfers.map((t) => t.dest_country))];
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { s: tab === "enviar" ? "enviar" : undefined, v: view.id === defaultView ? undefined : view.id, c: country, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/imports/transfers?${s}` : "/imports/transfers";
  };
  const preparing = transfers.filter((t) => t.status === "preparing");

  const inTransit = transfers.filter((t) => t.status === "transit");
  const late = inTransit.filter((t) => isLate(t, today)).length;
  const pendingUnits = pending.reduce((s, r) => s + r.pending, 0);
  const pendingBy = new Map<string, typeof pending>();
  for (const r of pending) pendingBy.set(r.country, [...(pendingBy.get(r.country) ?? []), r]);
  const routes = routeSummary(transfers, today)
    .filter((r) => r.preparing.transfers || r.transit.transfers || r.arrived.transfers)
    .sort((a, b) => (pointOf.get(a.origin_id)?.position ?? 0) - (pointOf.get(b.origin_id)?.position ?? 0) || (pointOf.get(a.dest_id)?.position ?? 0) - (pointOf.get(b.dest_id)?.position ?? 0));
  const origins = points.filter((p) => p.active && p.is_origin);
  const noPoints = points.length === 0;

  /** Lista de traslados (la misma en las dos pestañas). */
  const transferTable = (rows: TransferFull[]) => (
    <div className="table-scroll">
      <table className="table stack im-table tr-table">
        <thead>
          <tr>
            <th>Traslado</th>
            <th>Ruta</th>
            <th>Estado</th>
            <th className="r">Unidades</th>
            <th>Salió</th>
            <th>Llega</th>
            <th>Manifiesto</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const st = transferStatus(t.status);
            const tt = totals(t.items);
            const groups = byDestination(t, points);
            const lateNow = isLate(t, today);
            const lastArrival = t.arrivals.map((a) => a.arrived_at).sort().at(-1) ?? null;
            const hasManifest = (docs.get(t.id) ?? []).includes("manifest");
            return (
              <RowLink key={t.id} href={`/imports/transfers/${t.id}`}>
                <td data-slot="id">
                  <Link className="order-no" href={`/imports/transfers/${t.id}`}>{t.code}</Link>
                  <div className="sub clip">{[t.carrier, t.reference && `manifiesto ${t.reference}`].filter(Boolean).join(" · ") || "—"}</div>
                  {t.items.length > 0 && (
                    <ul className="im-prods" aria-label="Productos">
                      {t.items.slice(0, 3).map((i) => <li key={i.id} title={`${lineLabel(i)} · ${fmtInt(i.qty)} u.`}><span className="q">{fmtInt(i.qty)} u.</span> {lineLabel(i)}</li>)}
                      {t.items.length > 3 && <li className="more">+{t.items.length - 3} más</li>}
                    </ul>
                  )}
                </td>
                <td>
                  <div>{pointName(t.origin_id)} → {countryName(t.dest_country)}</div>
                  <div className="sub">{groups.map((g) => `${g.point.name}${g.arrival ? " ✓" : ""}`).join(" · ") || "Sin productos"}</div>
                </td>
                <td data-slot="status">
                  <span className="pill" data-tone={st.tone}>{st.label}</span>
                  {t.status === "transit" && t.arrivals.length > 0 && <div className="sub">llegó a {t.arrivals.length} de {groups.length}</div>}
                  {tt.counted > 0 && hasIssues(tt) && <div className="sub im-alert-text">{[tt.shortage && `merma ${fmtInt(tt.shortage)}`, tt.damaged && `${fmtInt(tt.damaged)} dañadas`].filter(Boolean).join(" · ")}</div>}
                </td>
                <td className="num">{fmtInt(tt.sent)}{tt.counted > 0 && <div className="sub">llegaron {fmtInt(tt.received)}</div>}</td>
                <td className="nowrap">{shortDay(t.shipped_at)}</td>
                <td className="nowrap">
                  {t.status === "arrived" ? <>Llegó {shortDay(lastArrival)}</> : t.status === "cancelled" ? <span className="subtle">—</span> : (
                    <span className={lateNow ? "im-alert-text" : undefined}>{shortDay(t.eta)}{lateNow && " · vencida"}</span>
                  )}
                </td>
                <td className="nowrap">{hasManifest ? <span className="pill" data-tone="success">Subido</span> : t.status === "cancelled" ? <span className="subtle">—</span> : <span className="pill" data-tone="warning">Falta</span>}</td>
              </RowLink>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="page im-page tr-page">
      <PageHead
        title="Traslados"
        sub={<>
          {fmtInt(inTransit.length)} en camino
          {late > 0 && <> · <span className="im-alert-text">{late} con la llegada vencida</span></>}
          {pendingUnits > 0 && <> · {fmtInt(pendingUnits)} unidades por enviar</>}
          {" "}· envíos entre bodegas de varios productos juntos
        </>}
        actions={
          <>
            {edit && <Link className="btn" href="/imports/transfers/bodegas">Bodegas</Link>}
            {edit && !noPoints && (
              <SideSheet trigger={<><IconPlus /> Nuevo traslado</>} triggerClass="btn btn-primary" title="Nuevo traslado" sub="De dónde sale y a qué país va; después agregas los productos">
                <NewTransferForm action={createTransfer} points={points} countries={countries} />
              </SideSheet>
            )}
          </>
        }
      />
      <ImportsSubnav money={money} full={edit} />

      {noPoints ? (
        <div className="empty">
          <h3>Todavía no se puede usar</h3>
          <p>Falta preparar la base de datos de los traslados (las bodegas). Avísale al administrador.</p>
        </div>
      ) : (
        <>
          <nav className="tabs tr-sections" aria-label="Traslados">
            <Link href="/imports/transfers" aria-current={tab === "ruta"}>En ruta <span className="c">{fmtInt(inTransit.length)}</span></Link>
            <Link href="/imports/transfers?s=enviar" aria-current={tab === "enviar"}>Por enviar <span className="c">{fmtInt(preparing.length + pending.length)}</span></Link>
          </nav>
          {tab === "ruta" ? (
            <>
            <section className="panel" aria-labelledby="tr-routes-h">
              <div className="panel-head">
                <h2 id="tr-routes-h">Cuadro de rutas</h2>
                <span className="aside">De cada bodega de origen a cada bodega de destino · llegadas de los últimos 30 días</span>
              </div>
              {routes.length === 0 ? (
                <p className="panel-note subtle">Cuando armes traslados, aquí ves por ruta lo que se prepara, lo que va en camino y lo que llegó (con su merma).</p>
              ) : (
                <div className="table-scroll">
                  <table className="table tr-routes">
                    <thead>
                      <tr>
                        <th>Ruta</th>
                        <th className="r">Preparando</th>
                        <th className="r">En camino</th>
                        <th>Próxima llegada</th>
                        <th className="r">Llegaron</th>
                        <th className="r">Merma y dañadas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {routes.map((r) => {
                        const dest = pointOf.get(r.dest_id);
                        const issues = r.arrived.shortage + r.arrived.damaged;
                        return (
                          <tr key={`${r.origin_id}>${r.dest_id}`}>
                            <th scope="row">
                              <span className="tr-route">{pointName(r.origin_id)} <span aria-hidden>→</span><span className="sr-only">a</span> {pointName(r.dest_id)}</span>
                              {dest && <span className="sub">{countryName(dest.country)}</span>}
                            </th>
                            <td className="num">{r.preparing.units ? <>{fmtInt(r.preparing.units)} u.<div className="sub">{r.preparing.transfers} {r.preparing.transfers === 1 ? "traslado" : "traslados"}</div></> : <span className="subtle">—</span>}</td>
                            <td className="num strong">{r.transit.units ? <>{fmtInt(r.transit.units)} u.<div className="sub">{r.transit.transfers} {r.transit.transfers === 1 ? "traslado" : "traslados"}</div></> : <span className="subtle">—</span>}</td>
                            <td className="nowrap">
                              {r.transit.next_eta ? <span className={r.transit.late ? "im-alert-text" : undefined}>{shortDay(r.transit.next_eta)}{r.transit.late ? ` · ${r.transit.late} ${r.transit.late === 1 ? "vencido" : "vencidos"}` : ""}</span> : <span className="subtle">{r.transit.transfers ? "sin fecha" : "—"}</span>}
                            </td>
                            <td className="num">{r.arrived.transfers ? <>{fmtInt(r.arrived.received)} de {fmtInt(r.arrived.sent)} u.<div className="sub">{r.arrived.transfers} {r.arrived.transfers === 1 ? "traslado" : "traslados"}</div></> : <span className="subtle">—</span>}</td>
                            <td className="num">
                              {r.arrived.transfers ? (
                                issues ? <span className="im-alert-text">{[r.arrived.shortage && `${fmtInt(r.arrived.shortage)} merma`, r.arrived.damaged && `${fmtInt(r.arrived.damaged)} dañadas`].filter(Boolean).join(" · ")}</span> : <span className="tr-ok"><IconCheck aria-hidden /> completo</span>
                              ) : <span className="subtle">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <div className="tr-filters">
              <nav className="segmented" aria-label="Estado">
                {VIEWS.map((v) => (
                  <Link key={v.id} href={href({ v: v.id === defaultView ? undefined : v.id })} aria-current={view.id === v.id}>
                    {v.label} <span className="c">{fmtInt(transfers.filter((t) => v.test(t) && inScope(t)).length)}</span>
                  </Link>
                ))}
              </nav>
              {usedCountries.length > 1 && (
                <nav className="chips" aria-label="País destino">
                  <Link href={href({ c: undefined })} aria-current={!country}>Todos los países</Link>
                  {usedCountries.map((c) => <Link key={c} href={href({ c })} aria-current={country === c}>{countryName(c)}</Link>)}
                </nav>
              )}
            </div>

            <div className="table-wrap">
              {rows.length === 0 ? (
                <div className="empty">
                  <h3>{transfers.length ? "Nada en esta vista" : "Aún no hay traslados"}</h3>
                  <p>{transfers.length ? "Cambia de pestaña o de país." : "Crea el primero con “Nuevo traslado” o ármalo desde “Por enviar”: de dónde sale, a qué país va y sus productos con la bodega de cada uno."}</p>
                </div>
              ) : transferTable(rows)}
            </div>
            <p className="panel-note subtle">Estados: {TRANSFER_STATUSES.map((s) => s.label).join(" → ").replace(" → Cancelado", "")}. Un traslado llega cuando cada bodega de destino registra su llegada.</p>
            </>
          ) : (
            <>
            <section className="panel" aria-labelledby="tr-prep-h">
              <div className="panel-head">
                <h2 id="tr-prep-h">Armados, todavía no salen</h2>
                <span className="aside">Traslados preparándose: cuando salgan, márcalos como enviados (o ponles la fecha de salida) y pasan a En ruta</span>
              </div>
              {preparing.length === 0 ? (
                <p className="panel-note subtle">{edit ? "No hay traslados preparándose. Ármalos desde los repartos de abajo o con “Nuevo traslado”." : "No hay traslados preparándose."}</p>
              ) : transferTable(preparing)}
            </section>
            {edit && (
              <section className="panel" aria-labelledby="tr-pending-h">
                <div className="panel-head">
                  <h2 id="tr-pending-h">Repartos por enviar</h2>
                  <span className="aside">Lo repartido a otros países en Solicitudes y Laboratorios, menos lo que ya salió</span>
                </div>
                {pending.length === 0 ? (
                  <p className="panel-note subtle">Nada por enviar. Cuando en Solicitudes («Editar reparto») o en Laboratorios repartan unidades a Honduras, El Salvador o Costa Rica, aparecen aquí para armar el traslado.</p>
                ) : (
                  [...pendingBy.entries()].map(([c, list]) => (
                    <div className="tr-pending" key={c}>
                      <div className="tr-pending-head">
                        <h3>{countryName(c)} <span className="sub">{list.length} {list.length === 1 ? "producto" : "productos"} · {fmtInt(list.reduce((s, r) => s + r.pending, 0))} u.</span></h3>
                        {origins.length > 0 && (
                          <SideSheet trigger={<><IconPlus /> Armar traslado</>} triggerClass="btn btn-sm" title={`Traslado a ${countryName(c)}`} sub="Marca lo que sale junto, cuántas unidades y a qué bodega va">
                            <BuildTransferForm action={buildTransfer} country={c} countryName={countryName(c)} rows={list} points={points} />
                          </SideSheet>
                        )}
                      </div>
                      <div className="table-scroll">
                        <table className="table stack tr-pending-table">
                          <thead><tr><th>Producto</th><th>De</th><th>Bodega</th><th className="r">Repartido</th><th className="r">Enviado</th><th className="r">Falta</th><th><span className="sr-only">Acciones</span></th></tr></thead>
                          <tbody>
                            {list.map((r) => (
                              <tr key={r.source}>
                                <td data-slot="id"><span className="strong">{r.product}</span><div className="sub">{r.kind === "maquila" ? "Maquilado" : "Importado"}</div></td>
                                <td className="tr-wide">{r.from}<div className="sub">{r.state} · {shortDay(r.date)}</div></td>
                                <td className="tr-wide" data-label="Bodega">{r.dest_id ? pointName(r.dest_id) : <span className="subtle">se elige al armar</span>}</td>
                                <td className="num" data-label="Repartido">{fmtInt(r.allocated)}</td>
                                <td className="num" data-label="Enviado">{r.sent ? fmtInt(r.sent) : <span className="subtle">0</span>}</td>
                                <td className="num strong" data-label="Falta">{fmtInt(r.pending)}</td>
                                <td className="r"><SettleForm action={settlePending} source={r.source} product={r.product} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))
                )}
              </section>
            )}
            </>
          )}
        </>
      )}
    </div>
  );
}
