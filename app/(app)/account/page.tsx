import { PageHead } from "@/components/ui";
import { ChangePasswordForm, CloseSessionsButton } from "@/components/user-forms";
import { requireUser } from "@/lib/auth";
import { effectivePermissions, permissionLabel } from "@/lib/permissions";
import { changeOwnPassword, closeOtherSessions } from "./actions";
import "../settings/users/users.css";

export const metadata = { title: "Mi cuenta" };

export default async function AccountPage() {
  const user = await requireUser({ allowPasswordChange: true });
  const first = user.must_change_password;
  const perms = effectivePermissions(user);

  return (
    <div className="page page-narrow">
      <PageHead title={first ? "Crea tu contraseña" : "Mi cuenta"} sub={<>{user.name} · usuario {user.username}</>} />

      {first && (
        <div className="banner" data-tone="warning" role="status">
          Entraste con una contraseña temporal. Cámbiala por una tuya para usar el panel.
        </div>
      )}

      <section className="panel" aria-labelledby="acc-pass">
        <div className="panel-head"><h2 id="acc-pass">Contraseña</h2></div>
        <div className="panel-body">
          <ChangePasswordForm action={changeOwnPassword} first={first} />
        </div>
      </section>

      {!first && (
        <>
          <section className="panel" aria-labelledby="acc-perms">
            <div className="panel-head">
              <h2 id="acc-perms">Lo que puedes ver</h2>
              <span className="aside">{user.is_owner ? "Dueño" : "Lo define quien administra Usuarios"}</span>
            </div>
            <div className="panel-body acc-perms">
              <span className="tag">Inicio</span>
              {perms.map((p) => <span key={p} className="tag">{permissionLabel(p)}</span>)}
            </div>
          </section>

          <section className="panel" aria-labelledby="acc-sessions">
            <div className="panel-head"><h2 id="acc-sessions">Sesiones</h2></div>
            <div className="panel-body">
              <p className="sheet-note">Si entraste desde una computadora o un celular que ya no usas, cierra la sesión allí sin salir de esta.</p>
              <CloseSessionsButton action={closeOtherSessions} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
