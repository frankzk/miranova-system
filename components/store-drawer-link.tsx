"use client";

// Enlace que abre el panel lateral de una tienda. Sin precarga (con 70+ tiendas en pantalla
// serían decenas de peticiones compitiendo con el clic) y con el panel vacío al instante
// mientras llega el contenido, para que el clic se sienta inmediato.
import Link, { useLinkStatus } from "next/link";
import { useEffect } from "react";
import { createPortal } from "react-dom";

export function StoreDrawerLink({
  href, name, className, title, children,
}: { href: string; name: string; className?: string; title?: string; children: React.ReactNode }) {
  return (
    <Link href={href} prefetch={false} scroll={false} className={className} title={title}>
      {children}
      <Pending name={name} />
    </Link>
  );
}

function Pending({ name }: { name: string }) {
  const { pending } = useLinkStatus();
  if (!pending || typeof document === "undefined") return null;
  return createPortal(<DrawerSkeleton name={name} />, document.body);
}

/**
 * Panel lateral "cargando": el mismo marco del panel con bloques grises. Mientras está en
 * pantalla marca el documento para que el panel real, al reemplazarlo, no vuelva a deslizarse.
 */
export function DrawerSkeleton({ name }: { name?: string | null }) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.drawerLoading = "1";
    return () => {
      // el panel real se monta justo después: se le quita la animación por un momento
      window.setTimeout(() => delete root.dataset.drawerLoading, 400);
    };
  }, []);
  return (
    // los clics no deben llegar al enlace que lo abrió (el portal comparte sus eventos)
    <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <div className="drawer-overlay" aria-hidden />
      <div className="drawer sheet drawer-loading" role="dialog" aria-modal="true" aria-busy="true" aria-label={`Cargando ${name ?? "tienda"}`}>
        <div className="drawer-head sheet-head">
          <div className="grow">
            <h2 className="sheet-title">{name ?? "Cargando…"}</h2>
            <p className="sheet-sub"><span className="sk" style={{ width: 210 }} /></p>
          </div>
        </div>
        <div className="drawer-body sheet-body" aria-hidden>
          <div className="sk-kpis">
            {[0, 1, 2, 3].map((i) => <span key={i} className="sk sk-box" />)}
          </div>
          <span className="sk sk-title" />
          <span className="sk" style={{ width: "92%" }} />
          <span className="sk" style={{ width: "70%" }} />
          <span className="sk sk-title" />
          <span className="sk" style={{ width: "60%" }} />
          <span className="sk" style={{ width: "85%" }} />
          <span className="sk" style={{ width: "40%" }} />
          <span className="sk sk-title" />
          <span className="sk sk-block" />
        </div>
      </div>
    </div>
  );
}
