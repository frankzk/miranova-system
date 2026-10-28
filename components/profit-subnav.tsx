"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PermissionFlags } from "@/lib/permissions";

/** Vistas de Rentabilidad: la utilidad real de lo entregado y la ficha de costos de cada producto. */
export function ProfitSubnav({ sheets, perms }: { sheets: number; perms: Pick<PermissionFlags, "profit" | "product_costs" | "product_prices"> }) {
  const path = usePathname();
  const items = [
    { href: "/profit", label: "Rentabilidad", show: perms.profit },
    { href: "/profit/costs", label: `Costos por producto${sheets ? ` (${sheets})` : ""}`, show: perms.product_costs },
    { href: "/profit/prices", label: "Precios comerciales", show: perms.product_prices },
  ].filter((item) => item.show);
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
