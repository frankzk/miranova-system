import type { AccountView } from "@/lib/accounts";

/** Chips para filtrar por cuenta (operación). Cambian la cuenta activa del panel y vuelven a `next`. */
export function AccountChips({ accounts, current, next }: { accounts: AccountView[]; current?: string; next: string }) {
  if (accounts.length < 2) return null;
  const href = (id: string) => `/api/scope?${new URLSearchParams({ account: id, next })}`;
  return (
    <nav className="chips" aria-label="Filtrar por cuenta">
      <a href={href("")} aria-current={!current}>Todas</a>
      {accounts.map((a) => (
        <a key={a.id} href={href(a.id)} aria-current={current === a.id}>{a.name}</a>
      ))}
    </nav>
  );
}
