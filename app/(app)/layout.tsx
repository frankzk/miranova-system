import { AppFrame, type SideAccount } from "@/components/app-frame";
import { requireUser } from "@/lib/auth";
import { can, permissionFlags } from "@/lib/permissions";
import { listAccounts } from "@/lib/accounts";
import { fmtAgo } from "@/lib/format";
import { getScope } from "@/lib/scope";
import { db } from "@/lib/supabase";
import { groupById } from "@/lib/status";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // cambiar la contraseña temporal se hace dentro del panel (Mi cuenta), por eso se permite aquí;
  // cada página vuelve a exigir su permiso y la contraseña ya cambiada
  const [user, accounts] = await Promise.all([requireUser({ allowPasswordChange: true }), listAccounts()]);
  const scope = await getScope(accounts);

  // contador de órdenes con problemas para la navegación (mismo número que Inicio y la pestaña)
  let count = 0;
  if (can(user, "orders")) {
    let q = db()
      .from("orders")
      .select("id", { count: "exact", head: true })
      .in("status_code", groupById("problem")!.codes);
    if (scope.account) q = q.eq("account_id", scope.account);
    count = (await q).count ?? 0;
  }

  // estado de sincronización de cada cuenta: solo para quien administra Cuentas
  const admin = can(user, "accounts");
  const side: SideAccount[] = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    tone: !admin ? "neutral" : !a.enabled ? "neutral" : a.last_sync_ok === false ? "danger" : a.last_sync_ok ? "success" : "warning",
    meta: !admin ? "" : !a.enabled ? "Pausada" : a.last_sync_ok === false ? "Error al sincronizar" : `Sincronizado ${fmtAgo(a.last_sync_at)}`,
  }));

  return (
    <AppFrame
      accounts={side}
      scopeId={scope.account ?? null}
      scopeLabel={scope.label}
      attention={count}
      perms={permissionFlags(user)}
      user={{ name: user.name, username: user.username }}
      locked={user.must_change_password}
    >
      {children}
    </AppFrame>
  );
}
