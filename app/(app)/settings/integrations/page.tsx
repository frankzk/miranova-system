import { redirect } from "next/navigation";
import { DhlTestForm, IntegrationsForm } from "@/components/integrations-form";
import { SettingsSubnav } from "@/components/settings-subnav";
import { PageHead } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { integrationStatus } from "@/lib/integrations";
import { can } from "@/lib/permissions";
import { saveIntegrationsAction, testDhlAction } from "./actions";
import "../../imports/imports.css";

export const metadata = { title: "Integraciones" };

export default async function IntegrationsPage() {
  const me = await requireUser();
  if (!me.is_owner) redirect("/sin-acceso");
  const status = await integrationStatus();
  return (
    <div className="page page-narrow">
      <SettingsSubnav current="integrations" accounts={can(me, "accounts")} users={can(me, "users")} email />
      <PageHead title="Integraciones" sub="Servicios externos que usa el panel. Las claves se guardan cifradas y nunca se vuelven a mostrar." />
      <section className="panel" aria-labelledby="int-keys">
        <div className="panel-head"><h2 id="int-keys">Claves</h2></div>
        <div className="panel-body">
          <IntegrationsForm action={saveIntegrationsAction} dhl={status.dhl} track17={status.track17} anthropic={status.anthropic} />
        </div>
      </section>
      {status.dhl.source && (
        <section className="panel" aria-labelledby="int-test">
          <div className="panel-head"><h2 id="int-test">Probar DHL</h2></div>
          <div className="panel-body">
            <DhlTestForm action={testDhlAction} />
          </div>
        </section>
      )}
      <p className="footnote">
        Con la clave de DHL, las guías DHL se actualizan solas cada 3 horas directo con DHL (estado, última novedad y llegada que estima
        DHL); con la de 17TRACK, las de las demás paqueteras. También se puede pedir al instante con &ldquo;Actualizar ahora&rdquo; en cada importación. Con la de Anthropic, en Documentos aparece “Leer con IA” en las facturas (PDF o foto) para proponer los
        productos, cantidades y precios.
      </p>
    </div>
  );
}
