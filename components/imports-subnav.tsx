"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Vistas de Importaciones: la lista, los proveedores y (con permiso de Dinero) los reportes. */
export function ImportsSubnav({ money }: { money: boolean }) {
  const path = usePathname();
  const items = [
    { href: "/imports", label: "Importaciones" },
    { href: "/imports/suppliers", label: "Proveedores" },
    ...(money ? [{ href: "/imports/reports", label: "Reportes" }] : []),
  ];
  return (
    <nav className="segmented subnav" aria-label="Vista de importaciones">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={path === i.href ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
