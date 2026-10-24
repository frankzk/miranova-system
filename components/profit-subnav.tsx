"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Vistas de Rentabilidad: la utilidad real de lo entregado y la ficha de costos de cada producto. */
export function ProfitSubnav({ sheets }: { sheets: number }) {
  const path = usePathname();
  const items = [
    { href: "/profit", label: "Resumen" },
    { href: "/profit/costs", label: `Costos por producto${sheets ? ` (${sheets})` : ""}` },
  ];
  return (
    <nav className="segmented subnav" aria-label="Vista de rentabilidad">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={path === i.href ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
