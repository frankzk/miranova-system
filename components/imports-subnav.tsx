"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Vistas de Compras: importaciones, laboratorios, proveedores y (con permiso de Dinero) los reportes. */
export function ImportsSubnav({ money }: { money: boolean }) {
  const path = usePathname();
  const items = [
    { href: "/imports", label: "Importaciones" },
    { href: "/imports/labs", label: "Laboratorios" },
    { href: "/imports/suppliers", label: "Proveedores" },
    ...(money ? [{ href: "/imports/reports", label: "Reportes" }] : []),
  ];
  return (
    <nav className="segmented subnav" aria-label="Vista de compras">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={path === i.href ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
