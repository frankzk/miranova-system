import Link from "next/link";
import { IconPlus } from "@/components/icons";
import { ImportsSubnav } from "@/components/imports-subnav";
import { SideSheet } from "@/components/side-sheet";
import { DeleteSupplierForm, SupplierForm } from "@/components/supplier-forms";
import { PageHead } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { fmtInt, fmtMoney } from "@/lib/format";
import { supplierStats } from "@/lib/import-reports";
import { listSuppliers, reportData } from "@/lib/imports-data";
import { can } from "@/lib/permissions";
import { deleteSupplier, saveSupplier } from "./actions";
import "../imports.css";

export const metadata = { title: "Proveedores" };

const pct = (x: number) => `${Math.round(x * 100)} %`;
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("es-HN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function SuppliersPage() {
  const [user, suppliers, data] = await Promise.all([requirePermission("imports"), listSuppliers(), reportData()]);
  const money = can(user, "money");
  const stats = supplierStats(data.imports, data.items, data.costs);

  return (
    <div className="page im-page">
      <PageHead
        title="Proveedores"
        sub={<>{fmtInt(suppliers.length)} {suppliers.length === 1 ? "proveedor" : "proveedores"} · contacto, condiciones, qué les compras y cuánto tardan</>}
        actions={
          <SideSheet trigger={<><IconPlus /> Nuevo proveedor</>} triggerClass="btn btn-primary" title="Nuevo proveedor" sub="También puedes crearlo desde “Nueva importación”">
            <SupplierForm action={saveSupplier} />
          </SideSheet>
        }
      />
      <ImportsSubnav money={money} />

      <div className="table-wrap">
        {suppliers.length === 0 ? (
          <div className="empty">
            <h3>Aún no hay proveedores</h3>
            <p>Créalos aquí o con “+ Nuevo” al crear una importación: así eliges el proveedor y su origen sin escribirlos cada vez.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table stack im-table im-suppliers">
              <thead>
                <tr>
                  <th>Proveedor</th>
                  <th>Contacto</th>
                  <th className="r">Importaciones</th>
                  <th className="r" title="Promedio de días del pedido a la llegada, en las que ya llegaron">Tarda</th>
                  <th className="r" title="Faltantes y dañadas sobre lo pedido, según lo que se contó al recibir">Faltantes y dañadas</th>
                  {money && <th className="r">Comprado</th>}
                  <th className="hide-md">Le compras</th>
                  <th><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => {
                  const st = stats.get(s.id);
                  const wa = s.whatsapp ? `https://wa.me/${s.whatsapp.replace(/\D/g, "")}` : null;
                  return (
                    <tr key={s.id}>
                      <td data-slot="id">
                        <div className="strong">{s.name}</div>
                        <div className="sub">{s.origin ?? "Origen sin indicar"}{s.payment_terms && <> · {s.payment_terms}</>}</div>
                      </td>
                      <td>
                        {s.contact && <div>{s.contact}</div>}
                        <div className="sub im-contact">
                          {wa && <a href={wa} target="_blank" rel="noreferrer">WhatsApp</a>}
                          {s.email && <a href={`mailto:${s.email}`}>{s.email}</a>}
                          {!wa && !s.email && !s.contact && <span className="subtle">—</span>}
                        </div>
                      </td>
                      <td className="num">
                        {st ? <Link href={`/imports?v=todas&s=${s.id}`}>{fmtInt(st.imports)}</Link> : <span className="subtle">0</span>}
                        {st?.last && <div className="sub">última {shortDay(st.last)}</div>}
                      </td>
                      <td className="num">
                        {st?.leadDays != null ? <>{Math.round(st.leadDays)} días</> : <span className="subtle">—</span>}
                        {st?.onTime != null && <div className={`sub${st.onTime < 0.7 ? " im-alert-text" : ""}`}>a tiempo {pct(st.onTime)}</div>}
                      </td>
                      <td className="num">
                        {st?.lossRate != null ? <span className={st.lossRate >= 0.03 ? "im-alert-text" : undefined}>{pct(st.lossRate)}</span> : <span className="subtle">—</span>}
                      </td>
                      {money && <td className="num strong">{st && st.spent > 0 ? fmtMoney(st.spent, "USD") : <span className="subtle">—</span>}</td>}
                      <td className="hide-md">
                        <div className="sub im-buys">{st?.products.length ? st.products.slice(0, 3).map((p) => `${p.name} (${fmtInt(p.units)})`).join(" · ") : "—"}</div>
                      </td>
                      <td className="r nowrap">
                        <SideSheet trigger="Editar" triggerClass="btn btn-ghost btn-sm" title={s.name} sub="Datos del proveedor">
                          <SupplierForm action={saveSupplier} v={s} />
                          {!st && (
                            <div className="section im-recv-photos">
                              <DeleteSupplierForm action={deleteSupplier} id={s.id} name={s.name} />
                            </div>
                          )}
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
        Tarda: promedio de días del pedido a la llegada a la bodega. A tiempo: las que llegaron en la fecha estimada o antes. Faltantes y
        dañadas: según lo que se contó al recibir. No cuentan las cotizaciones ni las canceladas.
      </p>
    </div>
  );
}
