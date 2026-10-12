import { redirect } from "next/navigation";
import { IntegrationsForm, TrackTestForm } from "@/components/integrations-form";
import { SettingsSubnav } from "@/components/settings-subnav";
import { PageHead } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { integrationStatus } from "@/lib/integrations";
import { can } from "@/lib/permissions";
import { saveIntegrationsAction, testTrackingAction } from "./actions";
import "../../imports/imports.css";

export const metadata = { title: "Integraciones" };

export default async function IntegrationsPage() {
  const me = await requireUser();
  if (!me.is_owner) redirect("/sin-acceso");
  const status = await integrationStatus();
  // paqueteras con clave completa, para probarlas con una guía
  const testable = [
    { id: "dhl", label: "DHL", ok: !!status.dhl.source },
    { id: "fedex", label: "FedEx", ok: !!status.fedex_id.source && !!status.fedex_secret.source },
    { id: "ups", label: "UPS", ok: !!status.ups_id.source && !!status.ups_secret.source },
  ].filter((c) => c.ok);
  return (
    <div className="page page-narrow">
      <SettingsSubnav current="integrations" accounts={can(me, "accounts")} users={can(me, "users")} email />
      <PageHead title="Integraciones" sub="Servicios externos que usa el panel. Las claves se guardan cifradas y nunca se vuelven a mostrar." />
      <section className="panel" aria-labelledby="int-keys">
        <div className="panel-head"><h2 id="int-keys">Claves</h2></div>
        <div className="panel-body">
          <IntegrationsForm action={saveIntegrationsAction} status={status} />
        </div>
      </section>
      {testable.length > 0 && (
        <section className="panel" aria-labelledby="int-test">
          <div className="panel-head"><h2 id="int-test">Probar seguimiento</h2></div>
          <div className="panel-body">
            <TrackTestForm action={testTrackingAction} carriers={testable.map(({ id, label }) => ({ id, label }))} />
          </div>
        </section>
      )}
      <p className="footnote">
        Con las claves de DHL, FedEx y UPS, sus guías se actualizan solas cada 3 horas directo con cada paquetera (estado, última novedad y
        llegada estimada); con la de 17TRACK, las de cualquier otra paquetera. También se puede pedir al instante con &ldquo;Actualizar ahora&rdquo; en cada importación. Con la de Anthropic, en Documentos aparece “Leer con IA” en las facturas (PDF o foto) para proponer los
        productos, cantidades y precios.
      </p>
    </div>
  );
}
