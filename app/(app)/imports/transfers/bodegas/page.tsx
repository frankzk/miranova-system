import Link from "next/link";
import { IconPlus } from "@/components/icons";
import { ImportsSubnav } from "@/components/imports-subnav";
import { SideSheet } from "@/components/side-sheet";
import { PointForm } from "@/components/transfer-forms";
import { PageHead } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { COUNTRIES, countryByCode } from "@/lib/countries";
import { can } from "@/lib/permissions";
import { LAB_DESTINATIONS } from "@/lib/lab-purchases";
import { GOODS } from "@/lib/transfers";
import { listPoints } from "@/lib/transfers-data";
import { savePoint } from "../actions";
import "../../imports.css";
import "../transfers.css";

export const metadata = { title: "Bodegas de traslados" };

/** Bodegas de origen y destino de los traslados: qué reciben y a qué cuentas abastecen. */
export default async function PointsPage() {
  const [user, points] = await Promise.all([requirePermission("imports"), listPoints()]);
  const countries = COUNTRIES.map((c) => ({ code: c.code, name: c.name }));
  const account = (id: string) => LAB_DESTINATIONS.find((d) => d.id === id)?.label ?? id;
  const byCountry = new Map<string, typeof points>();
  for (const p of points) byCountry.set(p.country, [...(byCountry.get(p.country) ?? []), p]);
  return (
    <div className="page im-page tr-page">
      <p className="tr-back"><Link href="/imports/transfers">← Traslados</Link></p>
      <PageHead
        title="Bodegas"
        sub="De dónde salen y a dónde llegan los traslados. Una bodega que ya no se usa se oculta (no se borra: sus traslados la siguen mostrando)."
        actions={
          <SideSheet trigger={<><IconPlus /> Nueva bodega</>} triggerClass="btn btn-primary" title="Nueva bodega" sub="Origen, destino o los dos">
            <PointForm action={savePoint} countries={countries} />
          </SideSheet>
        }
      />
      <ImportsSubnav money={can(user, "money")} />
      {points.length === 0 ? (
        <div className="empty"><h3>Sin bodegas</h3><p>Falta preparar la base de datos de los traslados. Avísale al administrador.</p></div>
      ) : (
        <div className="table-wrap">
          <div className="table-scroll">
            <table className="table stack tr-points">
              <thead><tr><th>Bodega</th><th>País</th><th>Es</th><th>Como destino recibe</th><th>Abastece a</th><th><span className="sr-only">Acciones</span></th></tr></thead>
              <tbody>
                {[...byCountry.values()].flat().map((p) => (
                  <tr key={p.id} data-off={!p.active || undefined}>
                    <td data-slot="id"><span className="strong">{p.name}</span>{p.city && <div className="sub">{p.city}</div>}{!p.active && <div className="sub">Ya no se usa</div>}</td>
                    <td>{countryByCode(p.country)?.name ?? p.country}</td>
                    <td>{[p.is_origin && "Origen", p.is_destination && "Destino"].filter(Boolean).join(" y ")}</td>
                    <td>{p.is_destination ? GOODS.find((g) => g.id === p.goods)?.label : <span className="subtle">—</span>}</td>
                    <td>{p.accounts.length ? p.accounts.map(account).join(", ") : <span className="subtle">—</span>}</td>
                    <td className="r">
                      <SideSheet trigger="Editar" triggerClass="btn btn-ghost btn-sm" title={p.name} sub={countryByCode(p.country)?.name ?? p.country}>
                        <PointForm action={savePoint} point={p} countries={countries} />
                      </SideSheet>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="panel-note subtle">
        «Abastece a» sirve para «Por enviar»: lo repartido en Laboratorios a esa cuenta (p. ej. Mireva HN) va a esta bodega. Lo de Solicitudes es por país y
        la bodega se elige al armar el traslado. Lo repartido a Guatemala no necesita traslado.
      </p>
    </div>
  );
}
