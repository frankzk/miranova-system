import type { AccountView } from "@/lib/accounts";
import { setScopeAction } from "@/lib/scope-actions";

/**
 * Chips para filtrar por cuenta (operación). Cambian la cuenta activa del panel y vuelven a `next`
 * con una acción del servidor: navegación del cliente, sin recargar toda la página.
 */
export function AccountChips({ accounts, current, next }: { accounts: Pick<AccountView, "id" | "name">[]; current?: string; next: string }) {
  if (accounts.length < 2) return null;
  return (
    <form action={setScopeAction} className="chips" aria-label="Filtrar por cuenta">
      <input type="hidden" name="next" value={next} />
      <button type="submit" name="account" value="" aria-current={!current}>Todas</button>
      {accounts.map((a) => (
        <button key={a.id} type="submit" name="account" value={a.id} aria-current={current === a.id}>{a.name}</button>
      ))}
    </form>
  );
}
