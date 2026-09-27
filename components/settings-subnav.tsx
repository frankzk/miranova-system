import Link from "next/link";

/** Ajustes: cuentas de las plataformas y usuarios del panel (cada pestaña según su permiso). */
export function SettingsSubnav({ current, accounts, users }: { current: "accounts" | "users"; accounts: boolean; users: boolean }) {
  if (!accounts || !users) return null;
  return (
    <nav className="segmented subnav" aria-label="Ajustes">
      <Link href="/settings" aria-current={current === "accounts" ? "page" : undefined}>Cuentas de plataformas</Link>
      <Link href="/settings/users" aria-current={current === "users" ? "page" : undefined}>Usuarios</Link>
    </nav>
  );
}
