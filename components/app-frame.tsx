"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IconAccounts, IconBox, IconChart, IconChevronDown, IconHome, IconLogout, IconMenu, IconMoney, IconOrders, IconStore, IconTarget } from "./icons";
import type { Permission, PermissionFlags } from "@/lib/permissions";

export type SideAccount = { id: string; name: string; tone: "success" | "danger" | "neutral" | "warning"; meta: string };

// cada sección solo aparece con su permiso (la página igual lo vuelve a revisar)
const NAV: { href: string; label: string; icon: typeof IconHome; perm?: Permission; match: (p: string) => boolean }[] = [
  { href: "/", label: "Inicio", icon: IconHome, match: (p: string) => p === "/" },
  { href: "/business", label: "Negocio", icon: IconChart, perm: "business", match: (p: string) => p.startsWith("/business") },
  { href: "/opportunities", label: "Oportunidades", icon: IconTarget, perm: "opportunities", match: (p: string) => p.startsWith("/opportunities") },
  { href: "/orders", label: "Órdenes", icon: IconOrders, perm: "orders", match: (p: string) => p.startsWith("/orders") },
  { href: "/stores", label: "Tiendas", icon: IconStore, perm: "stores", match: (p: string) => p.startsWith("/stores") },
  { href: "/products", label: "Productos", icon: IconBox, perm: "products", match: (p: string) => p.startsWith("/products") },
  { href: "/money", label: "Dinero", icon: IconMoney, perm: "money", match: (p: string) => p.startsWith("/money") },
];

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Miranova, ir a Inicio">
      <span className="brand-mark" aria-hidden>M</span>
      <span className="brand-name">Miranova</span>
    </Link>
  );
}

export function AppFrame({
  accounts,
  scopeId,
  scopeLabel,
  attention,
  perms,
  user,
  locked,
  children,
}: {
  accounts: SideAccount[];
  scopeId: string | null;
  scopeLabel: string;
  attention: number;
  perms: PermissionFlags;
  user: { name: string; username: string };
  /** Debe cambiar la contraseña temporal: sin menú hasta hacerlo. */
  locked: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const scopeRef = useRef<HTMLDetailsElement>(null);
  const topScopeRef = useRef<HTMLDetailsElement>(null);

  // cerrar menú y selectores al navegar
  useEffect(() => {
    setOpen(false);
    scopeRef.current?.removeAttribute("open");
    topScopeRef.current?.removeAttribute("open");
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // al cambiar de cuenta se vuelve a la misma sección, sin la orden abierta
  const next = pathname;
  const scopeHref = (id: string) => `/api/scope?${new URLSearchParams({ account: id, next })}`;
  const menu = (
    <div className="scope-menu" role="menu">
      <a href={scopeHref("")} role="menuitem" aria-current={!scopeId}>
        Todas las cuentas
      </a>
      <div className="sep" />
      {accounts.map((a) => (
        <a key={a.id} href={scopeHref(a.id)} role="menuitem" aria-current={scopeId === a.id}>
          <span>{a.name}</span>
          <span className="dot" data-tone={a.tone} aria-hidden />
        </a>
      ))}
    </div>
  );

  return (
    <div className="app" data-nav={open ? "open" : "closed"}>
      <header className="topbar">
        <button className="btn btn-ghost btn-icon" onClick={() => setOpen(true)} aria-label="Abrir menú" aria-expanded={open}>
          <IconMenu />
        </button>
        <Brand />
        <span className="grow" />
        {accounts.length > 1 ? (
          <details className="scope scope-top" ref={topScopeRef}>
            <summary aria-label={`Cuenta activa: ${scopeLabel}. Cambiar`}>
              <span className="grow">{scopeLabel}</span>
              <IconChevronDown />
            </summary>
            {menu}
          </details>
        ) : (
          <span className="tag">{scopeLabel}</span>
        )}
      </header>

      {open && <button className="nav-scrim" aria-label="Cerrar menú" onClick={() => setOpen(false)} />}

      <aside className="sidebar" aria-label="Navegación principal">
        <Brand />

        {accounts.length > 1 && (
          <details className="scope" ref={scopeRef}>
            <summary aria-label={`Cuenta activa: ${scopeLabel}. Cambiar`}>
              <span className="grow">{scopeLabel}</span>
              <IconChevronDown />
            </summary>
            {menu}
          </details>
        )}

        <nav className="nav">
          {[
            ...NAV,
            // Ajustes: cuentas de plataformas y usuarios, según lo que la persona pueda administrar
            ...(perms.accounts || perms.users
              ? [{ href: perms.accounts ? "/settings" : "/settings/users", label: "Ajustes", icon: IconAccounts, match: (p: string) => p.startsWith("/settings") }]
              : []),
          ].filter((n) => !locked && (!("perm" in n) || !n.perm || perms[n.perm as Permission])).map(({ href, label, icon: Icon, match }) => (
            <Link key={href} href={href} aria-current={match(pathname) ? "page" : undefined}>
              <Icon />
              {label}
              {href === "/orders" && attention > 0 && (
                <span className="count" title="Órdenes con problemas">{attention}</span>
              )}
            </Link>
          ))}
        </nav>

        {accounts.length > 0 && perms.accounts && !locked && (
          <div className="side-section">
            <div className="side-label">Sincronización</div>
            <div className="side-accounts">
              {accounts.map((a) => (
                <Link key={a.id} href="/settings">
                  <span className="dot" data-tone={a.tone} aria-hidden />
                  <span className="name">{a.name}</span>
                  <span className="meta">{a.meta}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="sidebar-foot">
          <Link href="/account" className="side-user" aria-current={pathname.startsWith("/account") ? "page" : undefined} title="Mi cuenta: cambiar contraseña">
            <span className="avatar" aria-hidden>{initials(user.name)}</span>
            <span className="who">
              <span className="name">{user.name}</span>
              <span className="meta">{user.username} · Mi cuenta</span>
            </span>
          </Link>
          <form method="post" action="/api/logout">
            <button type="submit">
              <IconLogout />
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>

      <main className="main" id="main">{children}</main>
    </div>
  );
}
