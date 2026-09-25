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
        </div>

        <div className="items">
          <h2>Detalle de la orden</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Producto</th><th>Cantidad</th><th style={{ textAlign: "right" }}>Precio</th></tr>
              </thead>
              <tbody>
                {o.order_items.length === 0 && (
                  <tr><td colSpan={3} className="small">
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
                  </tr>
                ))}
                <tr className="total-row">
                  <td colSpan={2}>Total:</td>
                  <td className="num green">{fmtMoney(o.total, cur)}</td>
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
