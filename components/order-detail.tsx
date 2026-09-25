import { CopyButton } from "./client";
import { IconExternal, IconMail, IconOrders, IconPhone, IconPin, IconPrinter, IconStore, IconTruck } from "./icons";
import { place, StatusPill } from "./ui";
import { fmtDate, fmtMoney } from "@/lib/format";
import type { OrderDetail } from "@/lib/queries";

type TimelineEntry = { label: string; at: string | null };

function timelineOf(raw: OrderDetail["raw"]): TimelineEntry[] {
  const info = (raw?.orderInfo ?? null) as { statusTimeline?: unknown } | null;
  const list = Array.isArray(info?.statusTimeline) ? info!.statusTimeline : [];
  return (list as { label?: string; occurredAt?: string }[])
    .filter((x) => x && x.label)
    .map((x) => ({ label: x.label!, at: x.occurredAt ?? null }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** Encabezado + cuerpo del detalle. `head` recibe los controles del contenedor (cerrar, volver). */
export function OrderDetailView({ o, headControls }: { o: OrderDetail; headControls?: React.ReactNode }) {
  const tz = o.accounts?.timezone;
  const cur = o.currency ?? "HNL";
  const timeline = timelineOf(o.raw);
  const units = o.order_items.reduce((t, i) => t + i.quantity, 0);
  const phoneDigits = o.customer_phone?.replace(/\D/g, "");

  return (
    <>
      <div className="drawer-head">
        <div className="grow">
          <h2 className="order-title">
            #{o.external_id}
            <CopyButton value={o.external_id} label="Copiar número de orden" />
            <StatusPill code={o.status_code} label={o.status} />
          </h2>
          <p className="order-when">
            {fmtDate(o.ordered_at, tz)}
            {o.accounts?.name && <> · {o.accounts.name}</>}
            {o.shopify_order && <> · Shopify #{o.shopify_order}</>}
          </p>
        </div>
        {headControls}
      </div>

      <div className="drawer-body">
        {(o.label_url || o.tracking_url || phoneDigits) && (
          <div className="order-actions">
            {o.label_url && (
              <a className="btn" href={o.label_url} target="_blank" rel="noreferrer">
                <IconPrinter /> Imprimir guía
              </a>
            )}
            {o.tracking_url && (
              <a className="btn btn-primary" href={o.tracking_url} target="_blank" rel="noreferrer">
                Ver tracking <IconExternal />
              </a>
            )}
            {phoneDigits && (
              <a className="btn" href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noreferrer">
                <IconPhone /> WhatsApp
              </a>
            )}
          </div>
        )}

        <section className="section">
          <h3>Cliente</h3>
          <dl className="kv">
            <dt>Nombre</dt>
            <dd>{o.customer_name ?? "—"}</dd>
            <dt>Teléfono</dt>
            <dd>
              {o.customer_phone ? (
                <span className="with-icon"><IconPhone />{o.customer_phone}<CopyButton value={o.customer_phone} label="Copiar teléfono" /></span>
              ) : "—"}
            </dd>
            <dt>Correo</dt>
            <dd>{o.customer_email ? <span className="with-icon"><IconMail />{o.customer_email}</span> : "—"}</dd>
          </dl>
        </section>

        <section className="section">
          <h3>Entrega</h3>
          <dl className="kv">
            <dt>Destino</dt>
            <dd>{place(o.city, o.department) ? <span className="with-icon"><IconPin />{place(o.city, o.department)}</span> : "—"}</dd>
            <dt>Dirección</dt>
            <dd>{o.address ?? "—"}</dd>
            <dt>Punto de referencia</dt>
            <dd>{o.reference_point ?? "—"}</dd>
            <dt>Indicaciones</dt>
            <dd>{o.notes ?? <span className="muted">Sin indicaciones</span>}</dd>
            <dt>Paquetera</dt>
            <dd>{o.carrier ? <span className="with-icon"><IconTruck />{o.carrier}</span> : "—"}</dd>
            <dt>Guía</dt>
            <dd>
              {o.tracking_number ? (
                <span className="with-icon tabular">{o.tracking_number}<CopyButton value={o.tracking_number} label="Copiar guía" /></span>
              ) : "—"}
            </dd>
            <dt>Dropshipper</dt>
            <dd>{o.dropshipper ? <span className="with-icon"><IconStore />{o.dropshipper}</span> : "—"}</dd>
          </dl>
        </section>

        <section className="section">
          <h3>Productos · {units} {units === 1 ? "unidad" : "unidades"}</h3>
          {o.order_items.length === 0 ? (
            <p className="muted">Esta orden no trae productos.</p>
          ) : (
            <table className="items">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="r">Cant.</th>
                  <th className="r">Venta</th>
                  <th className="r">Te toca</th>
                </tr>
              </thead>
              <tbody>
                {o.order_items.map((it, i) => (
                  <tr key={i}>
                    <td>
                      <div className="prod">
                        {it.image_url ? <img src={it.image_url} alt="" loading="lazy" /> : <span className="ph" aria-hidden><IconOrders /></span>}
                        <div>
                          <strong>{it.product_name}</strong>
                          {it.sku && <span className="sku">SKU {it.sku}</span>}
                        </div>
                      </div>
                    </td>
                    <td className="r">{it.quantity}</td>
                    <td className="r">{fmtMoney(it.price, cur)}</td>
                    <td className="r">{fmtMoney(it.vendor_price, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="section">
          <h3>Pago</h3>
          <dl className="money-rows">
            <div><dt>Forma de pago</dt><dd>{o.cod === null ? "—" : o.cod ? "Contra entrega" : "Prepagado"}</dd></div>
            {o.shipping_cost !== null && <div><dt>Envío</dt><dd>{fmtMoney(o.shipping_cost, cur)}</dd></div>}
            <div className="total"><dt>Total cobrado al cliente</dt><dd>{fmtMoney(o.total, cur)}</dd></div>
            <div className="you"><dt>Te toca como proveedor</dt><dd>{fmtMoney(o.vendor_amount, cur)}</dd></div>
            {o.vendor_net !== null && <div><dt>Ganancia neta estimada</dt><dd>{fmtMoney(o.vendor_net, cur)}</dd></div>}
            <div>
              <dt>Liquidación</dt>
              <dd>
                {o.paid === null ? "—" : o.paid
                  ? <span className="pill" data-tone="success">Liquidada</span>
                  : <span className="pill" data-tone="neutral">Pendiente</span>}
              </dd>
            </div>
          </dl>
        </section>

        {timeline.length > 0 && (
          <section className="section">
            <h3>Historial</h3>
            <ol className="timeline">
              {timeline.map((t, i) => (
                <li key={i}>
                  <div>{t.label}</div>
                  <div className="when">{fmtDate(t.at, tz)}</div>
                </li>
              ))}
            </ol>
          </section>
        )}

        <details className="raw">
          <summary>Datos originales de la plataforma</summary>
          <pre>{JSON.stringify(o.raw, null, 2)}</pre>
        </details>
      </div>
    </>
  );
}
