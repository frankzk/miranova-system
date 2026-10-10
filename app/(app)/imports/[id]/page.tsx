import Link from "next/link";
import { notFound } from "next/navigation";
import { IconDownload, IconExternal, IconPlus } from "@/components/icons";
import {
  AddCostForm, AddItemForm, AddPaymentForm, DeleteImportForm, DocUpload, EditItemForm, ImportHeaderForm, RemoveButton, ReportBox, StatusForm,
} from "@/components/import-forms";
import { SideSheet } from "@/components/side-sheet";
import { PageHead } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { requirePermission } from "@/lib/auth";
import { countryByCode, COUNTRIES } from "@/lib/countries";
import { fmtInt, fmtMoney, todayIn } from "@/lib/format";
import {
  allocationLabel, costKindLabel, docKindLabel, DOC_KINDS, isActive, landedCosts, marginOf, MONEY_DOCS, needsReport, recoveryShare, statusInfo,
  trackingUrl, transportLabel, whatsappMessage,
} from "@/lib/imports";
import { getImport, productChoices, salePrices } from "@/lib/imports-data";
import { can } from "@/lib/permissions";
import {
  addImportCost, addImportItem, addImportPayment, deleteImport, removeImportCost, removeImportDocument, removeImportItem, removeImportPayment,
  setImportStatus, setReported, updateImport, updateImportItem,
} from "../actions";
import "../imports.css";

export const metadata = { title: "Importación" };

const day = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("es-HN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const when = (iso: string) => new Date(iso).toLocaleString("es-HN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Tegucigalpa" });
const usd = (n: number | null | undefined) => fmtMoney(n ?? null, "USD");
const pct = (x: number) => `${(x * 100).toFixed(0)} %`;
const kb = (n: number | null) => (n ? (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`) : "");

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const [user, accounts, { id }] = await Promise.all([requirePermission("imports"), listAccounts(), params]);
  const detail = await getImport(id);
  if (!detail) notFound();
  const { imp, items, costs, docs, payments, events, people } = detail;
  const money = can(user, "money");
  const today = todayIn();
  const [prices, choices] = await Promise.all([salePrices(items), productChoices(imp.dest_country)]);

  const landed = landedCosts(items, costs);
  const byItem = new Map(landed.items.map((r) => [r.id, r]));
  const country = countryByCode(imp.dest_country)?.name ?? imp.dest_country;
  const st = statusInfo(imp.status);
  const link = trackingUrl(imp.carrier, imp.tracking_number, imp.tracking_url);
  const paid = payments.reduce((t, p) => t + p.amount, 0);
  const revenue = items.reduce((t, i) => t + (prices.get(i.id) ?? 0) * i.qty, 0);
  const priced = items.every((i) => (prices.get(i.id) ?? 0) > 0);
  const profit = items.reduce((t, i) => {
    const m = marginOf(byItem.get(i.id)?.unit ?? 0, prices.get(i.id), i.qty);
    return t + (m?.total ?? 0);
  }, 0);
  const recovery = priced ? recoveryShare(landed.totals.total, revenue) : null;
  const visibleDocs = docs.filter((d) => money || !MONEY_DOCS.includes(d.kind));
  const docName = new Map(docs.map((d) => [d.id, d]));
  const alert = needsReport(imp, today);
  const late = isActive(imp.status) && imp.eta !== null && imp.eta < today;
  const message = whatsappMessage(imp, items, (c) => countryByCode(c)?.name ?? c, link);
  const mine = [...new Set(accounts.map((a) => a.country))];
  const countries = [...mine.map((c) => countryByCode(c)).filter((c): c is NonNullable<typeof c> => Boolean(c)), ...COUNTRIES.filter((c) => !mine.includes(c.code))]
    .map((c) => ({ code: c.code, name: c.name }));
  const photo = (i: (typeof items)[number]) => (i.photo_path ? `/api/imports/item/${i.id}` : i.image_url);

  return (
    <div className="page im-page">
      <PageHead
        crumbs={<Link href="/imports">Importaciones</Link>}
        title={<span className="im-title">{imp.code} <span className="pill" data-tone={st.tone}>{st.label}</span></span>}
        sub={<>{imp.supplier ?? "Sin proveedor"} · {imp.origin ?? "Origen sin indicar"} → <b>{country}</b> · {transportLabel(imp.transport)}</>}
        actions={<>
          <a className="btn" href={`/api/export/imports/${imp.id}`} download title="Descargar la importación en Excel"><IconDownload /> Excel</a>
          <SideSheet trigger="Editar datos" title={`Editar ${imp.code}`} sub="Proveedor, país, transporte, guía y fechas">
            <ImportHeaderForm action={updateImport} v={imp} countries={countries} />
          </SideSheet>
          <SideSheet trigger="Eliminar" triggerClass="btn btn-ghost btn-danger" title={`Eliminar ${imp.code}`}>
            <DeleteImportForm action={deleteImport} importId={imp.id} />
          </SideSheet>
        </>}
      />

      {/* resumen */}
      <section className="metrics" aria-label="Resumen">
        <div className="metric">
          <span className="label">Productos</span>
          <span className="value">{fmtInt(landed.totals.units)} u.</span>
          <span className="foot">{items.length} {items.length === 1 ? "producto" : "productos"}</span>
        </div>
        {money ? (
          <>
            <div className="metric">
              <span className="label">Costo total</span>
              <span className="value">{usd(landed.totals.total)}</span>
              <span className="foot">Costo promedio {usd(landed.totals.units ? landed.totals.total / landed.totals.units : 0)} por unidad</span>
            </div>
            <div className="metric" data-alert={priced && profit < 0 ? true : undefined}>
              <span className="label">Ganancia esperada</span>
              <span className="value">{priced ? usd(profit) : "—"}</span>
              <span className="foot">{priced ? (recovery !== null ? `Recuperas lo invertido al vender el ${pct(Math.min(recovery, 9.99))} de las unidades` : "") : "Falta el precio de venta de algún producto"}</span>
            </div>
            <div className="metric">
              <span className="label">Pagado</span>
              <span className="value">{usd(paid)}</span>
              <span className="foot">{landed.totals.total - paid > 0.005 ? `Falta pagar ${usd(landed.totals.total - paid)}` : landed.totals.total > 0 ? "Todo pagado" : "Sin costos todavía"}</span>
            </div>
          </>
        ) : (
          <>
            <div className="metric"><span className="label">Llegada</span><span className="value sm">{imp.arrived_at ? `Llegó ${day(imp.arrived_at)}` : day(imp.eta)}</span><span className="foot">{late ? "Atrasada" : imp.arrived_at ? "" : "Estimada"}</span></div>
            <div className="metric"><span className="label">Guía</span><span className="value sm">{imp.tracking_number ?? "—"}</span><span className="foot">{imp.carrier ?? ""}</span></div>
            <div className="metric"><span className="label">Bodega</span><span className="value sm">{imp.reported_at ? "Reportada" : "Sin avisar"}</span><span className="foot">{country}</span></div>
          </>
        )}
      </section>

      <div className="im-two">
        <section className="panel" aria-labelledby="im-st">
          <div className="panel-head"><h2 id="im-st">Estado y seguimiento</h2>{link && <a className="aside link" href={link} target="_blank" rel="noreferrer">Ver seguimiento <IconExternal /></a>}</div>
          <div className="panel-body">
            <dl className="im-facts">
              <div><dt>Transporte</dt><dd>{transportLabel(imp.transport)}{imp.carrier ? ` · ${imp.carrier}` : ""}</dd></div>
              <div><dt>Guía</dt><dd>{imp.tracking_number ? (link ? <a href={link} target="_blank" rel="noreferrer">{imp.tracking_number}</a> : imp.tracking_number) : "—"}</dd></div>
              <div><dt>Pedido</dt><dd>{day(imp.ordered_at)}</dd></div>
              <div><dt>Llegada estimada</dt><dd className={late ? "im-alert-text" : undefined}>{day(imp.eta)}{late ? " · atrasada" : ""}</dd></div>
              {imp.arrived_at && <div><dt>Llegó</dt><dd>{day(imp.arrived_at)}</dd></div>}
              {imp.weight_kg !== null && <div><dt>Peso</dt><dd>{imp.weight_kg} kg</dd></div>}
            </dl>
            {imp.notes && <p className="im-notes">{imp.notes}</p>}
            <StatusForm action={setImportStatus} importId={imp.id} current={imp.status} />
          </div>
        </section>

        <section className="panel" aria-labelledby="im-rep" data-alert={alert || undefined}>
          <div className="panel-head"><h2 id="im-rep">Aviso a la bodega</h2><span className="aside">Boxful · {country}</span></div>
          <div className="panel-body">
            {alert && <p className="im-warn">Llega {imp.eta && imp.eta < today ? "con retraso" : "en 3 días o menos"} y todavía no se avisó a la bodega.</p>}
            <p className="muted im-small">Copia el mensaje con los productos, la guía y la fecha, pégalo en el chat de Boxful y márcala como reportada.</p>
            <ReportBox action={setReported} importId={imp.id} reported={imp.reported_at} who={imp.reported_by ? people[imp.reported_by] ?? null : null} message={message} />
          </div>
        </section>
      </div>

      {/* productos */}
      <section className="table-wrap im-section" aria-labelledby="im-items">
        <div className="panel-head">
          <h2 id="im-items">Productos</h2>
          <SideSheet trigger={<><IconPlus /> Agregar producto</>} triggerClass="btn btn-sm" title="Agregar producto" sub={`Del catálogo de ${country} o un producto nuevo`}>
            <AddItemForm action={addImportItem} importId={imp.id} choices={choices} money={money} />
          </SideSheet>
        </div>
        {items.length === 0 ? (
          <p className="panel-body muted">Agrega los productos que vienen en esta importación.</p>
        ) : (
          <div className="table-scroll">
            <table className="table im-items">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="r">Cantidad</th>
                  {money && <th className="r">Costo proveedor</th>}
                  {money && <th className="r">Costo final por unidad</th>}
                  {money && <th className="r hide-md">Precio de venta</th>}
                  {money && <th className="r">Margen</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const lc = byItem.get(i.id)!;
                  const price = prices.get(i.id) ?? null;
                  const m = marginOf(lc.unit, price, i.qty);
                  const src = photo(i);
                  return (
                    <tr key={i.id}>
                      <td>
                        <div className="im-prod">
                          {src ? <img src={src} alt="" loading="lazy" /> : <span className="im-noimg" aria-hidden />}
                          <div>
                            <div className="strong">{i.name}</div>
                            <div className="sub">{i.sku ? `SKU ${i.sku}` : "Sin SKU"}{!i.product_external_id && <> · <span className="tag">Nuevo</span></>}{i.unit_weight_kg !== null && ` · ${i.unit_weight_kg} kg c/u`}</div>
                          </div>
                        </div>
                      </td>
                      <td className="num">{fmtInt(i.qty)}</td>
                      {money && <td className="num">{usd(i.unit_cost)}</td>}
                      {money && (
                        <td className="num strong" title={`Producto ${usd(lc.unitParts.product)} + envío ${usd(lc.unitParts.shipping)} + importación ${usd(lc.unitParts.import)} + adicionales ${usd(lc.unitParts.other)}`}>
                          {usd(lc.unit)}
                          <div className="sub">+{usd(lc.unit - lc.unitParts.product)} de envío e importación</div>
                        </td>
                      )}
                      {money && <td className="num hide-md">{price ? usd(price) : <span className="subtle">—</span>}<div className="sub">{price ? (i.sale_price_usd !== null ? "escrito a mano" : "de Drop") : ""}</div></td>}
                      {money && (
                        <td className="num">
                          {m ? <span className={m.low ? "im-alert-text" : "im-ok-text"}>{usd(m.unit)} · {pct(m.pct)}</span> : <span className="subtle">—</span>}
                          {m && <div className="sub">{usd(m.total)} en total{m.low ? " · margen bajo" : ""}</div>}
                        </td>
                      )}
                      <td className="nowrap r">
                        <SideSheet trigger="Editar" triggerClass="btn btn-ghost btn-sm" title={i.name} sub="Cantidad, costo, peso y precio">
                          <EditItemForm action={updateImportItem} item={i} money={money} />
                        </SideSheet>
                        <RemoveButton action={removeImportItem} name="item_id" value={i.id} confirmText={`¿Quitar ${i.name} de la importación?`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {money && (
                <tfoot>
                  <tr>
                    <td className="strong">Total</td>
                    <td className="num strong">{fmtInt(landed.totals.units)}</td>
                    <td className="num">{usd(landed.totals.product)}</td>
                    <td className="num strong">{usd(landed.totals.total)}</td>
                    <td className="hide-md" />
                    <td className="num strong">{priced ? usd(profit) : ""}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        {money && landed.notes.map((n) => <p key={n} className="im-note">{n}</p>)}
      </section>

      {money && (
        <div className="im-two">
          <section className="panel" aria-labelledby="im-costs">
            <div className="panel-head"><h2 id="im-costs">Costos</h2><span className="aside">USD · se reparten entre los productos</span></div>
            <div className="panel-body">
              <dl className="im-cost-sum">
                <div><dt>Productos</dt><dd>{usd(landed.totals.product)}</dd></div>
                <div><dt>Envío</dt><dd>{usd(landed.totals.shipping)}</dd></div>
                <div><dt>Importación</dt><dd>{usd(landed.totals.import)}</dd></div>
                <div><dt>Adicionales</dt><dd>{usd(landed.totals.other)}</dd></div>
                <div className="total"><dt>Total</dt><dd>{usd(landed.totals.total)}</dd></div>
              </dl>
              {costs.length > 0 && (
                <ul className="im-list">
                  {costs.map((c) => (
                    <li key={c.id}>
                      <span className="tag">{costKindLabel(c.kind)}</span>
                      <span className="grow">{c.label}<span className="sub"> · {allocationLabel(c.allocation)}{c.allocation === "item" ? `: ${items.find((i) => i.id === c.item_id)?.name ?? "—"}` : ""}</span></span>
                      <span className="num strong">{usd(c.amount)}</span>
                      <RemoveButton action={removeImportCost} name="cost_id" value={c.id} confirmText={`¿Quitar el costo "${c.label}"?`} />
                    </li>
                  ))}
                </ul>
              )}
              <AddCostForm action={addImportCost} importId={imp.id} items={items.map((i) => ({ id: i.id, name: i.name }))} />
            </div>
          </section>

          <section className="panel" aria-labelledby="im-pay">
            <div className="panel-head"><h2 id="im-pay">Pagos</h2><span className="aside">{usd(paid)} de {usd(landed.totals.total)}</span></div>
            <div className="panel-body">
              {payments.length > 0 && (
                <ul className="im-list">
                  {payments.map((p) => {
                    const d = p.document_id ? docName.get(p.document_id) : null;
                    return (
                      <li key={p.id}>
                        <span className="nowrap">{day(p.paid_at)}</span>
                        <span className="grow">{p.method}{p.note && <span className="sub"> · {p.note}</span>}{d && <> · <a href={`/api/imports/doc/${d.id}`} target="_blank" rel="noreferrer">comprobante</a></>}</span>
                        <span className="num strong">{usd(p.amount)}</span>
                        <RemoveButton action={removeImportPayment} name="payment_id" value={p.id} confirmText="¿Quitar este pago?" />
                      </li>
                    );
                  })}
                </ul>
              )}
              <AddPaymentForm action={addImportPayment} importId={imp.id} />
            </div>
          </section>
        </div>
      )}

      <div className="im-two">
        <section className="panel" aria-labelledby="im-docs">
          <div className="panel-head"><h2 id="im-docs">Documentos</h2><span className="aside">{visibleDocs.length} {visibleDocs.length === 1 ? "archivo" : "archivos"}</span></div>
          <div className="panel-body">
            {visibleDocs.length > 0 && (
              <ul className="im-list">
                {DOC_KINDS.flatMap((k) => visibleDocs.filter((d) => d.kind === k.id)).map((d) => (
                  <li key={d.id}>
                    <span className="tag">{docKindLabel(d.kind)}</span>
                    <span className="grow clip"><a href={`/api/imports/doc/${d.id}`} target="_blank" rel="noreferrer">{d.filename ?? "archivo"}</a><span className="sub"> · {kb(d.size_bytes)}</span></span>
                    <a className="btn btn-ghost btn-sm" href={`/api/imports/doc/${d.id}?dl=1`} aria-label={`Descargar ${d.filename ?? "archivo"}`}><IconDownload /></a>
                    <RemoveButton action={removeImportDocument} name="doc_id" value={d.id} label="Borrar" confirmText={`¿Borrar ${d.filename ?? "el archivo"}?`} />
                  </li>
                ))}
              </ul>
            )}
            <DocUpload importId={imp.id} money={money} />
          </div>
        </section>

        <section className="panel" aria-labelledby="im-hist">
          <div className="panel-head"><h2 id="im-hist">Historial</h2></div>
          <div className="panel-body">
            <ol className="im-timeline">
              {events.map((e) => (
                <li key={e.id}>
                  <span className="dot" data-tone={e.status ? statusInfo(e.status).tone : "neutral"} aria-hidden />
                  <div>
                    <div><b>{e.status ? statusInfo(e.status).label : e.note}</b>{e.status && e.note ? <span className="muted"> · {e.note}</span> : null}</div>
                    <div className="sub">{when(e.at)}{e.by_user && people[e.by_user] ? ` · ${people[e.by_user]}` : ""}</div>
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
