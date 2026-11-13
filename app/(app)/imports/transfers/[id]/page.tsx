import Link from "next/link";
import { notFound } from "next/navigation";
import { IconDownload, IconPlus } from "@/components/icons";
import { RemoveButton } from "@/components/import-forms";
import { SideSheet } from "@/components/side-sheet";
import {
  AddLineForm, ArrivalForm, DeleteTransferForm, EditLineForm, ShipForm, TransferDocUpload, TransferHeaderForm,
} from "@/components/transfer-forms";
import { PageHead } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { COUNTRIES, countryByCode } from "@/lib/countries";
import { fmtInt, todayIn } from "@/lib/format";
import { catalogChoices } from "@/lib/imports-data";
import { byDestination, destinationsFor, goodUnits, hasIssues, isLate, shortage, totals, transferStatus } from "@/lib/transfers";
import { getTransfer, listPoints } from "@/lib/transfers-data";
import {
  addTransferLine, deleteTransfer, registerArrival, removeTransferDocument, removeTransferLine, setTransferCancelled, shipTransfer, updateTransfer,
  updateTransferLine,
} from "../actions";
import "../../imports.css";
import "../transfers.css";

export const metadata = { title: "Traslado" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("es-HN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const when = (iso: string) => new Date(iso).toLocaleString("es-HN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Tegucigalpa" });
const kb = (n: number | null) => (n ? (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`) : "");
const DOC_LABEL: Record<string, string> = { manifest: "Manifiesto", photo: "Foto", other: "Documento" };

export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const [, { id }] = await Promise.all([requirePermission("imports"), params]);
  if (!UUID.test(id)) notFound();
  const [t, points] = await Promise.all([getTransfer(id), listPoints()]);
  if (!t) notFound();
  const today = todayIn();
  const st = transferStatus(t.status);
  const tt = totals(t.items);
  const groups = byDestination(t, points);
  const origin = points.find((p) => p.id === t.origin_id);
  const country = countryByCode(t.dest_country)?.name ?? t.dest_country;
  const dests = destinationsFor(points, t.dest_country).filter((p) => p.id !== t.origin_id);
  const late = isLate(t, today);
  const closed = t.status === "cancelled" || t.status === "arrived";
  const canAdd = !closed && dests.some((d) => !t.arrivals.some((a) => a.dest_id === d.id));
  // catálogo de Drop solo si se pueden agregar productos (pesa): el del país destino y, al buscar, los de otros países
  const catalog = canAdd ? await catalogChoices(t.dest_country).catch(() => ({ choices: [], foreign: [] })) : { choices: [], foreign: [] };
  const choices = [...catalog.choices, ...catalog.foreign.map((f) => ({ ...f, account_name: undefined, also: undefined }))];
  const countries = COUNTRIES.map((c) => ({ code: c.code, name: c.name }));
  const manifest = t.documents.filter((d) => d.kind === "manifest");

  return (
    <div className="page im-page tr-page">
      <p className="tr-back"><Link href="/imports/transfers">← Traslados</Link></p>
      <PageHead
        title={t.code}
        sub={<>
          <span className="pill" data-tone={st.tone}>{st.label}</span>
          {late && <> <span className="pill" data-tone="danger">Llegada vencida</span></>}
          {" "}· {origin?.name ?? "Origen borrado"} → <b>{country}</b>
          {t.carrier && <> · lo lleva {t.carrier}</>}
          {t.reference && <> · manifiesto {t.reference}</>}
        </>}
        actions={<>
          {t.status === "preparing" && (
            <SideSheet trigger="Marcar como enviado" triggerClass="btn btn-primary" title={`Enviar ${t.code}`} sub={t.items.length ? `${t.items.length} ${t.items.length === 1 ? "producto" : "productos"} · ${fmtInt(tt.sent)} u.` : "Primero agrega los productos"}>
              <ShipForm action={shipTransfer} id={t.id} carrier={t.carrier} reference={t.reference} eta={t.eta} />
            </SideSheet>
          )}
          <SideSheet trigger="Editar datos" title={`Editar ${t.code}`} sub="Origen, quién lo lleva, manifiesto y fechas">
            <TransferHeaderForm action={updateTransfer} v={t} points={points} countries={countries} hasItems={t.items.length > 0} />
          </SideSheet>
          {t.status !== "arrived" && (
            <RemoveButton
              action={setTransferCancelled} name="id" value={t.id} label={t.status === "cancelled" ? "Reabrir" : "Cancelar traslado"}
              confirmText={t.status === "cancelled" ? undefined : `¿Cancelar ${t.code}? No cuenta como enviado (vuelve a "Por enviar").`}
              extra={{ cancel: t.status === "cancelled" ? "0" : "1" }}
            />
          )}
          {!t.arrivals.length && (
            <SideSheet trigger="Eliminar" triggerClass="btn btn-ghost btn-danger" title={`Eliminar ${t.code}`}>
              <DeleteTransferForm action={deleteTransfer} transferId={t.id} />
            </SideSheet>
          )}
        </>}
      />

      <section className="metrics" aria-label="Resumen">
        <div className="metric">
          <span className="label">Salieron</span>
          <span className="value">{fmtInt(tt.sent)} u.</span>
          <span className="foot">{tt.lines} {tt.lines === 1 ? "producto" : "productos"} · {groups.length} {groups.length === 1 ? "bodega" : "bodegas"}</span>
        </div>
        <div className="metric">
          <span className="label">Salió</span>
          <span className="value sm">{t.shipped_at ? day(t.shipped_at) : "Todavía no"}</span>
          <span className="foot">{t.status === "preparing" ? "Se está preparando" : t.carrier ?? ""}</span>
        </div>
        <div className="metric" data-alert={late || undefined}>
          <span className="label">{t.status === "arrived" ? "Llegó" : "Llegada estimada"}</span>
          <span className="value sm">{t.status === "arrived" ? day(t.arrivals.map((a) => a.arrived_at).sort().at(-1) ?? null) : day(t.eta)}</span>
          <span className="foot">{late ? "Vencida: revisa con quien lo lleva" : t.arrivals.length && t.status === "transit" ? `Llegó a ${t.arrivals.length} de ${groups.length} bodegas` : ""}</span>
        </div>
        <div className="metric" data-alert={tt.counted > 0 && hasIssues(tt) ? true : undefined}>
          <span className="label">Llegaron</span>
          <span className="value">{tt.counted ? `${fmtInt(tt.received)} u.` : "—"}</span>
          <span className="foot">{tt.counted ? ([tt.shortage && `merma ${fmtInt(tt.shortage)}`, tt.damaged && `${fmtInt(tt.damaged)} dañadas`].filter(Boolean).join(" · ") || "Completo, sin daños") : "Se registra en cada bodega"}</span>
        </div>
      </section>

      {groups.length === 0 && (
        <section className="panel">
          <div className="panel-head"><h2>Productos</h2></div>
          <p className="panel-body muted">Agrega los productos que salen en este traslado, cada uno con la bodega a la que va.</p>
        </section>
      )}

      {groups.map((g) => {
        const editable = !closed && !g.arrival;
        const canArrive = t.status === "transit" || (t.status === "arrived" && !!g.arrival);
        return (
          <section className="panel tr-dest" key={g.point.id} aria-labelledby={`tr-d-${g.point.id}`}>
            <div className="panel-head">
              <h2 id={`tr-d-${g.point.id}`}>→ {g.point.name}</h2>
              <span className="aside">
                {g.arrival ? <>Llegó el {day(g.arrival.arrived_at)}{g.arrival.received_by && t.people[g.arrival.received_by] ? ` · registró ${t.people[g.arrival.received_by].split(" ")[0]}` : ""}</> : t.status === "transit" ? (late ? <span className="im-alert-text">Sin llegar · vencida</span> : "En camino") : t.status === "preparing" ? "Preparando" : st.label}
              </span>
              {canArrive && (
                <SideSheet trigger={g.arrival ? "Corregir llegada" : "Registrar llegada"} triggerClass={g.arrival ? "btn btn-ghost btn-sm" : "btn btn-primary btn-sm"} title={`Llegada a ${g.point.name}`} sub={`${t.code} · ${fmtInt(g.totals.sent)} u. salieron`}>
                  <ArrivalForm
                    action={registerArrival} transferId={t.id} destId={g.point.id} arrivedAt={g.arrival?.arrived_at ?? null} note={g.arrival?.note ?? null} minDate={t.shipped_at}
                    lines={g.items.map((i) => ({ id: i.id, name: i.name, qty: i.qty, received_qty: i.received_qty, damaged_qty: i.damaged_qty, received_note: i.received_note }))}
                  />
                </SideSheet>
              )}
            </div>
            {g.arrival?.note && <p className="panel-note">{g.arrival.note}</p>}
            <div className="table-scroll">
              <table className="table stack tr-lines">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="r">Salieron</th>
                    <th className="r">Llegaron</th>
                    <th className="r">Dañadas</th>
                    <th className="r">Merma</th>
                    <th className="r">Buenas</th>
                    {editable && <th><span className="sr-only">Acciones</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((i) => {
                    const miss = shortage(i);
                    return (
                      <tr key={i.id}>
                        <td data-slot="id">
                          <div className="tr-prod">
                            {i.image_url ? <img src={i.image_url} alt="" loading="lazy" /> : <span className="im-noimg" aria-hidden />}
                            <div>
                              <span className="strong">{i.name}</span>
                              <div className="sub">{[i.kind === "maquila" ? "Maquilado" : "Importado", i.sku && `SKU ${i.sku}`, i.source && (i.source.startsWith("lab:") ? "de Laboratorios" : "de una solicitud")].filter(Boolean).join(" · ")}</div>
                              {i.received_note && <div className="sub tr-note">{i.received_note}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="num strong" data-label="Salieron">{fmtInt(i.qty)}</td>
                        <td className="num" data-label="Llegaron">{i.received_qty === null ? <span className="subtle">—</span> : fmtInt(i.received_qty)}</td>
                        <td className="num" data-label="Dañadas">{i.received_qty === null ? <span className="subtle">—</span> : i.damaged_qty ? <span className="im-alert-text">{fmtInt(i.damaged_qty)}</span> : "0"}</td>
                        <td className="num" data-label="Merma">{miss === null ? <span className="subtle">—</span> : miss ? <span className="im-alert-text">{fmtInt(miss)}</span> : "0"}</td>
                        <td className="num" data-label="Buenas">{i.received_qty === null ? <span className="subtle">—</span> : fmtInt(goodUnits(i) ?? 0)}</td>
                        {editable && (
                          <td className="r nowrap">
                            <SideSheet trigger="Editar" triggerClass="btn btn-ghost btn-sm" title={i.name} sub="Unidades, clase y bodega">
                              <EditLineForm action={updateTransferLine} transferId={t.id} item={i} dests={dests} />
                            </SideSheet>
                            <RemoveButton action={removeTransferLine} name="item_id" value={i.id} confirmText={`¿Quitar ${i.name} del traslado?`} extra={{ id: t.id }} />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {canAdd && (
        <div className="tr-add">
          <SideSheet trigger={<><IconPlus /> Agregar producto</>} triggerClass="btn" title="Agregar producto" sub={`A una bodega de ${country}`}>
            <AddLineForm action={addTransferLine} transferId={t.id} dests={dests.filter((d) => !t.arrivals.some((a) => a.dest_id === d.id))} choices={choices} foreign={[]} country={country} />
          </SideSheet>
        </div>
      )}

      <div className="im-two">
        <section className="panel" aria-labelledby="tr-docs">
          <div className="panel-head">
            <h2 id="tr-docs">Manifiesto y documentos</h2>
            <span className="aside">{manifest.length ? "Manifiesto subido" : <span className="im-warn-text">Falta el manifiesto</span>}</span>
          </div>
          <div className="panel-body">
            {t.documents.length > 0 && (
              <ul className="im-list">
                {t.documents.map((d) => (
                  <li key={d.id}>
                    <span className="tag">{DOC_LABEL[d.kind] ?? "Documento"}</span>
                    <span className="grow clip"><a href={`/api/transfers/doc/${d.id}`} target="_blank" rel="noreferrer">{d.filename ?? "archivo"}</a><span className="sub"> · {kb(d.size_bytes)}</span></span>
                    <a className="btn btn-ghost btn-sm" href={`/api/transfers/doc/${d.id}?dl=1`} aria-label={`Descargar ${d.filename ?? "archivo"}`}><IconDownload /></a>
                    <RemoveButton action={removeTransferDocument} name="doc_id" value={d.id} label="Borrar" confirmText={`¿Borrar ${d.filename ?? "el archivo"}?`} />
                  </li>
                ))}
              </ul>
            )}
            <TransferDocUpload transferId={t.id} />
            {t.notes && <p className="tr-notes"><b>Notas:</b> {t.notes}</p>}
          </div>
        </section>

        <section className="panel" aria-labelledby="tr-hist">
          <div className="panel-head"><h2 id="tr-hist">Historial</h2></div>
          <div className="panel-body">
            <ol className="im-timeline">
              {t.events.map((e) => (
                <li key={e.id}>
                  <span className="dot" data-tone="neutral" aria-hidden />
                  <div>
                    <div><b>{e.note}</b></div>
                    <div className="sub">{when(e.at)}{e.by_user && t.people[e.by_user] ? ` · ${t.people[e.by_user]}` : ""}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>
    </div>
  );
}
