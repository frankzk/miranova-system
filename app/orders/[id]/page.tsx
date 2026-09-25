import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLogin } from "@/lib/auth";
import { getOrder } from "@/lib/queries";
import { fmtDate, fmtMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireLogin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const o = await getOrder(id);
  if (!o) notFound();

  const cur = o.currency ?? "HNL";
  const field = (k: string, v: string | null | undefined) => (
    <div>
      <div className="k">{k}</div>
      <div className="v">{v || "—"}</div>
    </div>
  );

  return (
    <main className="wrap" style={{ maxWidth: 860 }}>
      <div className="top">
        <div>
          <h1>Orden #{o.external_id}</h1>
          <div className="sub">{fmtDate(o.ordered_at)}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {o.status && <span className="chip">{o.status}</span>}
          <Link className="btn" href="/">← Volver</Link>
        </div>
      </div>

      <section className="card">
        <div className="detail">
          {field("Cuenta", o.accounts?.name)}
          {field("Nombre completo", o.customer_name)}
          {field("Paquetera", o.carrier)}
          {field("Correo electrónico", o.customer_email)}
          {field("Teléfono", o.customer_phone)}
          {field("Dropshipper", o.dropshipper)}
          {field("Orden Shopify", o.shopify_order)}
          {field("Departamento", o.department)}
          {field("Ciudad", o.city)}
          {field("Dirección", o.address)}
          {field("Punto de referencia", o.reference_point)}
          {field("Indicaciones", o.notes)}
          {field("Guía", o.tracking_number)}
          {field("Pago", o.cod === null ? null : o.cod ? "Contra entrega" : "Prepagado")}
          {field("Tú recibes", o.vendor_amount === null ? null : fmtMoney(o.vendor_amount, cur))}
          {field("Ganancia neta estimada", o.vendor_net === null ? null : fmtMoney(o.vendor_net, cur))}
          {field("Liquidado", o.paid === null ? null : o.paid ? "Sí" : "No")}
        </div>

        <div className="items">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>Detalle de la orden</h2>
            <div style={{ display: "flex", gap: 8 }}>
              {o.label_url && <a className="btn" href={o.label_url} target="_blank" rel="noreferrer">Imprimir guía</a>}
              {o.tracking_url && <a className="btn primary" href={o.tracking_url} target="_blank" rel="noreferrer">Ver tracking ↗</a>}
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Producto</th><th>Cantidad</th><th style={{ textAlign: "right" }}>Precio</th><th style={{ textAlign: "right" }}>Tú recibes</th></tr>
              </thead>
              <tbody>
                {o.order_items.length === 0 && (
                  <tr><td colSpan={4} className="small">
                    Sin productos capturados. Abre esta orden en Drop con la extensión activa.
                  </td></tr>
                )}
                {o.order_items.map((it, i) => (
                  <tr key={i}>
                    <td>
                      <div className="item-row">
                        {it.image_url && <img src={it.image_url} alt="" />}
                        <div>
                          <strong>{it.product_name}</strong>
                          {it.sku && <div className="small">SKU {it.sku}</div>}
                        </div>
                      </div>
                    </td>
                    <td>{it.quantity}</td>
                    <td className="num">{fmtMoney(it.price, cur)}</td>
                    <td className="num">{fmtMoney(it.vendor_price, cur)}</td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td colSpan={2}>Total:</td>
                  <td className="num green">{fmtMoney(o.total, cur)}</td>
                  <td className="num">{fmtMoney(o.vendor_amount, cur)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <details className="raw">
          <summary>Datos originales de Drop (JSON)</summary>
          <pre>{JSON.stringify(o.raw, null, 2)}</pre>
        </details>
      </section>
    </main>
  );
}
