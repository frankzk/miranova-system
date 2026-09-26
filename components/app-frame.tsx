"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogoHorizontal } from "./logo";
import { IconAccounts, IconBox, IconChevronDown, IconHome, IconLogout, IconMenu, IconMoney, IconOrders } from "./icons";

export type SideAccount = { id: string; name: string; tone: "success" | "danger" | "neutral" | "warning"; meta: string };

const NAV = [
  { href: "/", label: "Inicio", icon: IconHome, match: (p: string) => p === "/" },
  { href: "/orders", label: "Órdenes", icon: IconOrders, match: (p: string) => p.startsWith("/orders") },
  { href: "/products", label: "Productos", icon: IconBox, match: (p: string) => p.startsWith("/products") },
  { href: "/money", label: "Dinero", icon: IconMoney, match: (p: string) => p.startsWith("/money") },
  { href: "/settings", label: "Cuentas", icon: IconAccounts, match: (p: string) => p.startsWith("/settings") },
];

function Brand({ height = 36 }: { height?: number }) {
  return (
    <Link href="/" className="brand" aria-label="Miranova, ir a Inicio">
      <LogoHorizontal height={height} tone="light" />
    </Link>
  );
}

export function AppFrame({
  accounts,
  scopeId,
  scopeLabel,
  attention,
  children,
}: {
  accounts: SideAccount[];
  scopeId: string | null;
  scopeLabel: string;
  attention: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const scopeRef = useRef<HTMLDetailsElement>(null);

  // cerrar menú y selector al navegar
  useEffect(() => {
    setOpen(false);
    scopeRef.current?.removeAttribute("open");
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

  return (
    <div className="app" data-nav={open ? "open" : "closed"}>
      <header className="topbar">
        <button className="btn btn-ghost btn-icon" onClick={() => setOpen(true)} aria-label="Abrir menú" aria-expanded={open}>
          <IconMenu />
        </button>
        <Brand height={30} />
        <span className="grow" />
        <span className="tag">{scopeLabel}</span>
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
          </details>
        )}

        <nav className="nav">
          {NAV.map(({ href, label, icon: Icon, match }) => (
            <Link key={href} href={href} aria-current={match(pathname) ? "page" : undefined}>
              <Icon />
              {label}
              {href === "/orders" && attention > 0 && (
                <span className="count" title="Órdenes con problemas">{attention}</span>
              )}
            </Link>
          ))}
        </nav>

        {accounts.length > 0 && (
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
