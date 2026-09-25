import { AppFrame, type SideAccount } from "@/components/app-frame";
import { requireLogin } from "@/lib/auth";
import { listAccounts } from "@/lib/accounts";
import { fmtAgo } from "@/lib/format";
import { getScope } from "@/lib/scope";
import { db } from "@/lib/supabase";
import { groupById } from "@/lib/status";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireLogin();
  const accounts = await listAccounts();
  const scope = await getScope(accounts);

  // contador de órdenes con problemas para la navegación (mismo número que Inicio y la pestaña)
  let q = db()
    .from("orders")
    .select("id", { count: "exact", head: true })
    .in("status_code", groupById("problem")!.codes);
  if (scope.account) q = q.eq("account_id", scope.account);
  const { count } = await q;

  const side: SideAccount[] = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    tone: !a.enabled ? "neutral" : a.last_sync_ok === false ? "danger" : a.last_sync_ok ? "success" : "warning",
    meta: !a.enabled ? "Pausada" : a.last_sync_ok === false ? "Error al sincronizar" : `Sincronizado ${fmtAgo(a.last_sync_at)}`,
  }));

  return (
    <AppFrame accounts={side} scopeId={scope.account ?? null} scopeLabel={scope.label} attention={count ?? 0}>
      {children}
    </AppFrame>
  );
}
