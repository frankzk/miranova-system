import { redirect } from "next/navigation";
import { EmailSettingsForm, TestEmailForm } from "@/components/email-settings-form";
import { SettingsSubnav } from "@/components/settings-subnav";
import { PageHead } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { emailStatus } from "@/lib/email";
import { loadPanelEmail } from "@/lib/email-settings";
import { can } from "@/lib/permissions";
import { saveEmailSettingsAction, sendTestEmailAction } from "./actions";
import "./email.css";

export const metadata = { title: "Correo" };

export default async function EmailSettingsPage() {
  const me = await requireUser();
  if (!me.is_owner) redirect("/sin-acceso");
  const [panel, status] = await Promise.all([loadPanelEmail(), emailStatus()]);

  return (
    <div className="page page-narrow em-page">
      <SettingsSubnav current="email" accounts={can(me, "accounts")} users={can(me, "users")} email />
      <PageHead title="Correo" sub="Desde qué cuenta salen los correos del panel y quién recibe el resumen diario de inventario" />

      <div className="banner em-status" data-tone={status.provider ? "success" : "warning"} role="status">
        <span className="dot" data-tone={status.provider ? "success" : "warning"} aria-hidden />
        <span>
          {status.provider === "gmail" && <>Los correos salen desde <b>{status.sender}</b> (Gmail{status.source === "vercel" ? ", configurado en Vercel" : ""}).</>}
          {status.provider === "resend" && <>Los correos salen por Resend desde <b>{status.sender}</b>, configurado en Vercel.</>}
          {!status.provider && <>Todavía no hay una cuenta para enviar: los correos del panel no salen.</>}
        </span>
      </div>

      <section className="panel" aria-labelledby="em-account">
        <div className="panel-head"><h2 id="em-account">Cuenta que envía y destinatarios</h2></div>
        <div className="panel-body">
          <EmailSettingsForm
            action={saveEmailSettingsAction}
            gmailUser={panel?.gmailUser ?? ""}
            hasPassword={Boolean(panel?.gmailAppPassword)}
            digestTo={panel?.digestTo ?? []}
          />
          <details className="em-help">
            <summary>Cómo obtener la contraseña de aplicación de Gmail</summary>
            <ol>
              <li>Entra a la cuenta de Gmail que va a enviar y activa la <b>verificación en 2 pasos</b> (myaccount.google.com → Seguridad).</li>
              <li>Abre <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">myaccount.google.com/apppasswords</a>, ponle un nombre (por ejemplo “Panel Miranova”) y créala.</li>
              <li>Copia las 16 letras aquí arriba. No uses la contraseña normal de la cuenta: Gmail no la acepta para esto.</li>
            </ol>
            <p>Si cambias la contraseña de esa cuenta de Gmail, Google anula la contraseña de aplicación: crea una nueva y guárdala aquí.</p>
          </details>
        </div>
      </section>

      <section className="panel" aria-labelledby="em-test">
        <div className="panel-head"><h2 id="em-test">Probar</h2></div>
        <div className="panel-body em-test-body">
          <p className="muted">Envía un correo de prueba a quienes reciben el resumen. El resumen llega cada día a las 6:45 am (Honduras), solo si hay algo que pedir.</p>
          <TestEmailForm action={sendTestEmailAction} />
        </div>
      </section>

      <p className="footnote">
        También se usa para enviarle a cada usuario su contraseña temporal al crearlo o restablecerla (Ajustes → Usuarios), si su usuario es un correo.
        La contraseña de aplicación se guarda cifrada, igual que las de las cuentas de Drop, y nunca se muestra.
      </p>
    </div>
  );
}
