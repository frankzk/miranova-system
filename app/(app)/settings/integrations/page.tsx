import { redirect } from "next/navigation";
import { IntegrationsForm } from "@/components/integrations-form";
import { SettingsSubnav } from "@/components/settings-subnav";
import { PageHead } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { integrationStatus } from "@/lib/integrations";
import { can } from "@/lib/permissions";
import { saveIntegrationsAction } from "./actions";
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
          <IntegrationsForm action={saveIntegrationsAction} track17={status.track17} anthropic={status.anthropic} />
        </div>
      </section>
      <p className="footnote">
        Con la clave de 17TRACK, las importaciones con guía se actualizan solas cada pocas horas (estado, última novedad y llegada que
        estima la paquetera). Con la de Anthropic, en Documentos aparece “Leer con IA” en las facturas (PDF o foto) para proponer los
        productos, cantidades y precios.
      </p>
    </div>
  );
}
