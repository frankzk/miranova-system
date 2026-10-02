"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/products", label: "Catálogo" },
  { href: "/products/performance", label: "Rendimiento" },
  { href: "/products/inventory", label: "Inventario" },
  { href: "/products/matrix", label: "Tienda × producto" },
  { href: "/products/competencia", label: "Competencia" },
];

/** Vistas de Productos: catálogo del proveedor, rendimiento en pedidos y matriz tienda × producto. */
export function ProductsSubnav() {
  const path = usePathname();
  return (
    <nav className="segmented subnav" aria-label="Vista de productos">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} aria-current={path === i.href ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
