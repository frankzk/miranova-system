"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Vistas de Compras: importaciones, laboratorios, traslados, proveedores y (con permiso de Dinero) los reportes.
 * Con "Compras (solo ver)" (`full` en false), solo importaciones y traslados.
 */
export function ImportsSubnav({ money, full = true }: { money: boolean; full?: boolean }) {
  const path = usePathname();
  const items = [
    { href: "/imports", label: "Importaciones" },
    ...(full ? [{ href: "/imports/labs", label: "Laboratorios" }] : []),
    { href: "/imports/transfers", label: "Traslados" },
    ...(full ? [{ href: "/imports/suppliers", label: "Proveedores" }] : []),
    ...(money && full ? [{ href: "/imports/reports", label: "Reportes" }] : []),
  ];
  return (
    <nav className="segmented subnav" aria-label="Vista de compras">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={path === i.href || (i.href !== "/imports" && path.startsWith(`${i.href}/`)) ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
