import Link from "next/link";

type Tab = "accounts" | "users" | "email";

/** Ajustes: cuentas de las plataformas, usuarios del panel y correo (cada pestaña según su permiso; Correo, solo el dueño). */
export function SettingsSubnav({ current, accounts, users, email = false }: { current: Tab; accounts: boolean; users: boolean; email?: boolean }) {
  const tabs = [
    accounts && { id: "accounts" as const, href: "/settings", label: "Cuentas de plataformas" },
    users && { id: "users" as const, href: "/settings/users", label: "Usuarios" },
    email && { id: "email" as const, href: "/settings/email", label: "Correo" },
  ].filter(Boolean) as { id: Tab; href: string; label: string }[];
  if (tabs.length < 2) return null;
  return (
    <nav className="segmented subnav" aria-label="Ajustes">
      {tabs.map((t) => (
        <Link key={t.id} href={t.href} aria-current={current === t.id ? "page" : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}
