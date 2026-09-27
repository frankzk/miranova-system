import { PageHead } from "@/components/ui";
import { IconPlus } from "@/components/icons";
import { SideSheet } from "@/components/side-sheet";
import { EditUserForm, NewUserForm, ResetPasswordForm } from "@/components/user-forms";
import { requirePermission } from "@/lib/auth";
import { fmtAgo } from "@/lib/format";
import { can, effectivePermissions, permissionLabel, PERMISSION_KEYS, type Permission } from "@/lib/permissions";
import { listUsers, type AppUser } from "@/lib/users";
import { createUserAction, resetPasswordAction, updateUserAction } from "./actions";
import "./users.css";

export const metadata = { title: "Usuarios" };

export default async function UsersPage() {
  const me = await requirePermission("users");
  const users = await listUsers();
  // permisos que este administrador no tiene: no puede darlos ni quitarlos
  const lockedPerms: Permission[] = PERMISSION_KEYS.filter((p) => !can(me, p));
  const active = users.filter((u) => u.active).length;

  return (
    <div className="page">
      <PageHead
        title="Usuarios"
        sub={<>{active} {active === 1 ? "usuario activo" : "usuarios activos"} · cada uno entra con su usuario y ve solo lo que tiene marcado</>}
        actions={
          <SideSheet triggerClass="btn btn-primary" trigger={<><IconPlus /> Nuevo usuario</>} title="Nuevo usuario" sub="Entrará con una contraseña temporal y la cambiará al primer ingreso.">
            <div className="section">
              <NewUserForm action={createUserAction} lockedPerms={lockedPerms} canMakeOwner={me.is_owner} />
            </div>
          </SideSheet>
        }
      />

      <section className="panel" aria-label="Usuarios del panel">
        <ul className="users-list">
          {users.map((u) => (
            <UserRow key={u.id} u={u} me={me} lockedPerms={lockedPerms} />
          ))}
        </ul>
      </section>

      <p className="footnote">
        Tras 5 intentos fallidos, un usuario queda bloqueado 15 minutos. Al restablecer una contraseña o desactivar un usuario se cierran sus
        sesiones abiertas. Solo un dueño puede editar a otro dueño, y quien administra usuarios solo puede dar los permisos que él mismo tiene.
      </p>
    </div>
  );
}

function UserRow({ u, me, lockedPerms }: { u: AppUser; me: { id: string; is_owner: boolean }; lockedPerms: Permission[] }) {
  const self = u.id === me.id;
  const editable = !u.is_owner || me.is_owner;
  const perms = effectivePermissions(u);
  return (
    <li className="user-row" data-inactive={!u.active || undefined}>
      <span className="avatar" aria-hidden>{initials(u.name)}</span>
      <div className="who">
        <span className="name">
          {u.name}
          {self && <span className="you">tú</span>}
        </span>
        <span className="meta">
          {u.username} · {u.last_login_at ? `último ingreso ${fmtAgo(u.last_login_at)}` : "aún no ha entrado"}
        </span>
      </div>
      <div className="perms">
        {u.is_owner ? (
          <span className="pill" data-tone="accent">Dueño · todo</span>
        ) : perms.length === 0 ? (
          <span className="muted">Solo Inicio</span>
        ) : (
          perms.map((p) => <span key={p} className="tag">{permissionLabel(p)}</span>)
        )}
      </div>
      <div className="state">
        {!u.active ? (
          <span className="pill">Desactivado</span>
        ) : u.must_change_password ? (
          <span className="pill" data-tone="warning">Contraseña temporal</span>
        ) : (
          <span className="pill" data-tone="success">Activo</span>
        )}
      </div>
      <div className="act">
        {editable ? (
          <SideSheet triggerClass="btn btn-sm" trigger="Editar" title={u.name} sub={<>{u.username}{u.is_owner && " · Dueño"}</>}>
            <div className="section">
              <h3>Permisos y estado</h3>
              <EditUserForm
                action={updateUserAction}
                user={{ id: u.id, name: u.name, username: u.username, permissions: u.permissions, is_owner: u.is_owner, active: u.active }}
                lockedPerms={lockedPerms}
                canMakeOwner={me.is_owner}
                self={self}
              />
            </div>
            {!self && (
              <div className="section">
                <h3>Restablecer contraseña</h3>
                <p className="sheet-note">Pon una contraseña temporal y compártela con {u.name.split(" ")[0]}; al entrar deberá cambiarla.</p>
                <ResetPasswordForm action={resetPasswordAction} userId={u.id} />
              </div>
            )}
          </SideSheet>
        ) : (
          <span className="muted" title="Solo un dueño puede editar a otro dueño">—</span>
        )}
      </div>
    </li>
  );
}

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
