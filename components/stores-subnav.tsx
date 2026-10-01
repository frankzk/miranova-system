"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/stores", label: "Salud de tiendas" },
  { href: "/stores/nuevas", label: "Tiendas nuevas" },
];

/** Vistas de Tiendas: salud (ritmo de pedidos) y tiendas nuevas (cuándo entró cada una). */
export function StoresSubnav() {
  const path = usePathname();
  return (
    <nav className="segmented subnav" aria-label="Vista de tiendas">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} aria-current={path === i.href ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
