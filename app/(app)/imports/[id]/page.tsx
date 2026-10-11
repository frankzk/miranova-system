import Link from "next/link";
import { notFound } from "next/navigation";
import { IconDownload, IconExternal, IconPlus } from "@/components/icons";
import {
  AddCostForm, AddItemForm, AddPaymentForm, DeleteImportForm, DocUpload, EditItemForm, ImportHeaderForm, LinkItemForm, ReceptionForm, RemoveButton,
  ReportBox, StatusForm, TrackRefreshForm,
} from "@/components/import-forms";
import { InvoiceReader } from "@/components/invoice-reader";
import { SideSheet } from "@/components/side-sheet";
import { PageHead } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { requirePermission } from "@/lib/auth";
import { countryByCode, COUNTRIES } from "@/lib/countries";
import { fmtInt, fmtMoney, todayIn } from "@/lib/format";
import {
  allInDrop, allocationLabel, costKindLabel, counted, docKindLabel, DOC_KINDS, INBOUND, isActive, landedCosts, marginOf, MONEY_DOCS, needsReport,
  receptionSummary, recoveryShare, staleDays, STALE_DAYS, statusInfo, trackingUrl, transportLabel, whatsappMessage, type DropState, type ImportStatus,
} from "@/lib/imports";
import { dropStates, getImport, listSuppliers, productChoices, salePrices } from "@/lib/imports-data";
import { integrationKey } from "@/lib/integrations";
import { trackAlert, trackStatusInfo } from "@/lib/tracking17";
import { can } from "@/lib/permissions";
import {
  addImportCost, addImportItem, addImportPayment, deleteImport, linkImportItem, removeImportCost, removeImportDocument, removeImportItem,
  addInvoiceLines, refreshImportTracking, removeImportPayment, saveReception, setImportStatus, setReported, updateImport, updateImportItem,
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
  const [prices, choices, drop, suppliers, trackKey, aiKey] = await Promise.all([
    salePrices(items), productChoices(imp.dest_country), dropStates(items, today), listSuppliers(),
    integrationKey("track17").then(Boolean), integrationKey("anthropic").then(Boolean),
  ]);
  /** documentos que la IA puede leer: PDF o foto de hasta 20 MB (no fotos de recepción) */
  const readable = (d: (typeof docs)[number]) =>
    aiKey && d.kind !== "photo" && ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(d.content_type) && (d.size_bytes ?? 0) <= 20 * 1024 * 1024;
  // seguimiento automático: solo si lo guardado es de la guía actual
  const tracked = imp.tracking_number && imp.track_registered === imp.tracking_number ? imp : null;
  const trackable = Boolean(imp.tracking_number) && ["ready", "transit", "customs", "released", "to_warehouse"].includes(imp.status);
  const stale = staleDays(imp, events[0]?.at ?? null, today);
  const supplier = imp.supplier_id ? suppliers.find((x) => x.id === imp.supplier_id) : undefined;

  const landed = landedCosts(items, costs);
  const byItem = new Map(landed.items.map((r) => [r.id, r]));
  /** unidades buenas de la línea (recibidas sin daño o, sin contar, las pedidas) */
  const good = (i: (typeof items)[number]) => byItem.get(i.id)?.good ?? i.qty;
  const reception = receptionSummary(items);
  const lastCount = items.filter((i) => i.received_at).sort((a, b) => b.received_at!.localeCompare(a.received_at!))[0];
  const inDrop = allInDrop(items, drop);
  const autoSoon = INBOUND.includes(imp.status as ImportStatus) && inDrop.done;
  const photos = docs.filter((d) => d.kind === "photo").length;
  const country = countryByCode(imp.dest_country)?.name ?? imp.dest_country;
  const st = statusInfo(imp.status);
  const link = trackingUrl(imp.carrier, imp.tracking_number, imp.tracking_url);
  const paid = payments.reduce((t, p) => t + p.amount, 0);
  const revenue = items.reduce((t, i) => t + (prices.get(i.id) ?? 0) * good(i), 0);
  const priced = items.every((i) => (prices.get(i.id) ?? 0) > 0);
  const profit = items.reduce((t, i) => {
    const m = marginOf(byItem.get(i.id)?.unit ?? 0, prices.get(i.id), good(i));
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
        sub={<>
          {imp.supplier ?? "Sin proveedor"}
          {supplier?.whatsapp && <> (<a href={`https://wa.me/${supplier.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">WhatsApp</a>)</>}
          {" "}· {imp.origin ?? "Origen sin indicar"} → <b>{country}</b> · {transportLabel(imp.transport)}
        </>}
        actions={<>
          <a className="btn" href={`/api/export/imports/${imp.id}`} download title="Descargar la importación en Excel"><IconDownload /> Excel</a>
          <SideSheet trigger="Editar datos" title={`Editar ${imp.code}`} sub="Proveedor, país, transporte, guía y fechas">
            <ImportHeaderForm action={updateImport} v={imp} countries={countries} suppliers={suppliers.map((x) => ({ id: x.id, name: x.name, origin: x.origin }))} />
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
          <span className="foot">{reception.started ? `${fmtInt(reception.good)} buenas al recibir` : `${items.length} ${items.length === 1 ? "producto" : "productos"}`}</span>
        </div>
        {money ? (
          <>
            <div className="metric">
              <span className="label">Costo total</span>
              <span className="value">{usd(landed.totals.total)}</span>
              <span className="foot">Costo promedio {usd(landed.totals.good ? landed.totals.total / landed.totals.good : 0)} por unidad{reception.started ? " buena" : ""}</span>
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
            {stale !== null && (
              <p className="im-warn">Sin novedades hace {stale} días (avisa a los {STALE_DAYS}): revisa el seguimiento y anota cómo va.</p>
            )}
            {autoSoon && (
              <p className="im-ok">
                Drop ya registró la entrada de todos los productos ({fmtInt(inDrop.units)} u.). En la próxima sincronización pasa sola a &ldquo;Ingresado en Drop&rdquo;.
              </p>
            )}
            {(trackable || tracked?.track_status) && (
              <div className="im-track" data-alert={trackAlert(tracked?.track_status ?? null) || undefined}>
                <div className="im-track-head">
                  <b>Seguimiento automático</b>
                  {tracked?.track_status && <span className="pill" data-tone={trackStatusInfo(tracked.track_status).tone}>{trackStatusInfo(tracked.track_status).label}</span>}
                </div>
                {tracked?.track_event && (
                  <p className="im-track-event">
                    {tracked.track_event}
                    {tracked.track_event_at && <span className="sub"> · {when(tracked.track_event_at)}</span>}
                  </p>
                )}
                {tracked?.track_eta && <p className="im-small">La paquetera estima que llega el <b>{day(tracked.track_eta)}</b>{imp.eta && imp.eta !== tracked.track_eta ? ` (tú pusiste ${day(imp.eta)})` : ""}.</p>}
                {imp.track_error && <p className="im-alert-text im-small">{imp.track_error}</p>}
                {!trackKey ? (
                  <p className="muted im-small">Para que la guía se actualice sola, el dueño agrega la clave de 17TRACK en Ajustes → Integraciones.</p>
                ) : (
                  <div className="im-track-foot">
                    <span className="sub">{imp.track_checked_at ? `Revisado ${when(imp.track_checked_at)} · se revisa cada 3 horas` : "Se revisa en la próxima sincronización (cada 3 horas)."}</span>
                    {trackable && <TrackRefreshForm action={refreshImportTracking} importId={imp.id} />}
                  </div>
                )}
              </div>
            )}
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
                  <th>Llegada</th>
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
                  const m = marginOf(lc.unit, price, lc.good);
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
                      <td className="num">
                        {fmtInt(i.qty)}
                        {counted(i) && (
                          <div className={`sub${i.received_qty! < i.qty || i.damaged_qty > 0 ? " im-alert-text" : ""}`}>
                            llegaron {fmtInt(i.received_qty!)}{i.damaged_qty > 0 && ` · ${fmtInt(i.damaged_qty)} dañadas`}
                          </div>
                        )}
                      </td>
                      <td className="nowrap">
                        <DropCell st={drop.get(i.id)!} status={imp.status} />
                        {drop.get(i.id)?.kind === "unlinked" && choices.length > 0 && (
                          <SideSheet trigger="Enlazar" triggerClass="btn btn-ghost btn-sm im-link" title={`Enlazar ${i.name}`} sub={`Con su producto en Drop ${country}`}>
                            <LinkItemForm action={linkImportItem} itemId={i.id} name={i.name} choices={choices} />
                          </SideSheet>
                        )}
                      </td>
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
                    <td />
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

      {/* recepción */}
      {items.length > 0 && (
        <section className="panel im-section" aria-labelledby="im-recv">
          <div className="panel-head">
            <h2 id="im-recv">Recepción en bodega</h2>
            <SideSheet
              trigger={reception.started ? "Editar recepción" : "Registrar recepción"}
              triggerClass={reception.started ? "btn btn-sm" : "btn btn-sm btn-primary"}
              title="Recepción en bodega"
              sub={`${imp.code} · lo que contaron en ${country}`}
            >
              <ReceptionForm
                action={saveReception}
                importId={imp.id}
                lines={items.map((i) => {
                  const st = drop.get(i.id);
                  return {
                    id: i.id, name: i.name, sku: i.sku, qty: i.qty, received_qty: i.received_qty, damaged_qty: i.damaged_qty, received_note: i.received_note,
                    drop: st?.kind === "in" && st.seen ? st.units : null,
                  };
                })}
              />
              <div className="section im-recv-photos">
                <h3>Fotos de la recepción</h3>
                <p className="muted im-small">De lo que llegó dañado o de las cajas. Quedan en Documentos.</p>
                <DocUpload importId={imp.id} money={money} fixedKind="photo" label="Subir fotos" />
              </div>
            </SideSheet>
          </div>
          <div className="panel-body">
            {!reception.started ? (
              <p className="muted im-small">
                Cuando llegue a la bodega, anota cuánto llegó de cada producto y lo que vino dañado (con fotos). Lo que falte o llegue dañado se descuenta y el costo por unidad se calcula con las unidades buenas.
              </p>
            ) : (
              <>
                <dl className="im-recv-sum">
                  <div><dt>Pedidas</dt><dd>{fmtInt(reception.ordered)}</dd></div>
                  <div><dt>Llegaron</dt><dd>{fmtInt(reception.received)}</dd></div>
                  <div data-bad={reception.missing > 0 || undefined}><dt>Faltan</dt><dd>{fmtInt(reception.missing)}</dd></div>
                  <div data-bad={reception.damaged > 0 || undefined}><dt>Dañadas</dt><dd>{fmtInt(reception.damaged)}</dd></div>
                  <div className="total"><dt>Buenas</dt><dd>{fmtInt(reception.good)}</dd></div>
                </dl>
                {items.some((i) => counted(i) && (i.received_qty !== i.qty || i.damaged_qty > 0 || i.received_note)) && (
                  <ul className="im-list">
                    {items.filter((i) => counted(i) && (i.received_qty !== i.qty || i.damaged_qty > 0 || i.received_note)).map((i) => {
                      const diff = i.received_qty! - i.qty;
                      return (
                        <li key={i.id}>
                          <span className="grow">
                            {i.name}
                            <span className="sub">
                              {[diff < 0 ? `faltan ${fmtInt(-diff)}` : diff > 0 ? `sobran ${fmtInt(diff)}` : "", i.damaged_qty ? `${fmtInt(i.damaged_qty)} dañadas` : "", i.received_note ?? ""].filter(Boolean).map((t) => ` · ${t}`).join("")}
                            </span>
                          </span>
                          <span className="num">{fmtInt(i.received_qty!)} de {fmtInt(i.qty)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {!reception.complete && <p className="im-warn">Falta contar {items.length - reception.lines} {items.length - reception.lines === 1 ? "producto" : "productos"}.</p>}
                <p className="sub">
                  {lastCount ? <>Contada el {day(lastCount.received_at!.slice(0, 10))}{lastCount.received_by && people[lastCount.received_by] ? ` por ${people[lastCount.received_by]}` : ""}</> : null}
                  {photos > 0 && <> · {photos} {photos === 1 ? "foto" : "fotos"} en Documentos</>}
                </p>
              </>
            )}
          </div>
        </section>
      )}

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
                    {readable(d) && (
                      <SideSheet trigger="Leer con IA" triggerClass="btn btn-ghost btn-sm im-ai-btn" title="Leer con IA" sub={d.filename ?? "Documento"}>
                        <InvoiceReader docId={d.id} docName={d.filename ?? "el documento"} importId={imp.id} money={money} action={addInvoiceLines} />
                      </SideSheet>
                    )}
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

/** Cómo va la línea frente a Drop: ya entró, en camino (cuenta en Inventario) o producto nuevo sin enlazar. */
function DropCell({ st, status }: { st: DropState; status: string }) {
  if (st.kind === "in") {
    const d = new Date(st.at.length === 10 ? `${st.at}T12:00:00Z` : st.at).toLocaleDateString("es-HN", { day: "numeric", month: "short", timeZone: "UTC" });
    return <><span className="pill" data-tone="success">En Drop</span><div className="sub">{fmtInt(st.units)} u. · {d}{!st.seen && " · marcada a mano"}</div></>;
  }
  if (st.kind === "coming") return <><span className="pill" data-tone={st.late ? "warning" : "info"}>{st.late ? "Atrasada" : "En camino"}</span><div className="sub">cuenta en Inventario</div></>;
  if (st.kind === "unlinked") return <><span className="pill">Sin enlazar</span><div className="sub">producto nuevo: se enlaza al aparecer en Drop</div></>;
  return <span className="subtle">{status === "cancelled" ? "Cancelada" : "Al pagarla, cuenta en Inventario"}</span>;
}
