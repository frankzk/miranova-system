"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IconCheck, IconClose, IconCopy } from "./icons";

/** Fila de tabla que abre un enlace al hacer clic (sin interferir con links, botones o selección de texto). */
export function RowLink({ href, selected, children }: { href: string; selected?: boolean; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <tr
      className="row-link"
      aria-selected={selected || undefined}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest("a, button, input, select") || window.getSelection()?.toString()) return;
        if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
        else router.push(href, { scroll: false });
      }}
    >
      {children}
    </tr>
  );
}

/** Panel lateral: Esc cierra, el foco entra al abrir y vuelve al cerrar. */
export function Drawer({ closeHref, label, children }: { closeHref: string; label: string; children: React.ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(closeHref, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [closeHref, router]);

  return (
    <>
      <div className="drawer-overlay" onClick={() => router.push(closeHref, { scroll: false })} aria-hidden />
      <div className="drawer" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={ref}>
        {children}
      </div>
    </>
  );
}

export function DrawerClose({ href }: { href: string }) {
  const router = useRouter();
  return (
    <button className="btn btn-ghost btn-icon" onClick={() => router.push(href, { scroll: false })} aria-label="Cerrar detalle (Esc)">
      <IconClose />
    </button>
  );
}

export function CopyButton({ value, label = "Copiar" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-icon btn-sm"
      aria-label={done ? "Copiado" : label}
      title={done ? "Copiado" : label}
      onClick={async () => {
        await navigator.clipboard.writeText(value).catch(() => {});
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
    >
      {done ? <IconCheck style={{ color: "var(--success-dot)" }} /> : <IconCopy />}
    </button>
  );
}

/** <select> que envía su formulario al cambiar. */
export function AutoSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`select ${props.className ?? ""}`} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
