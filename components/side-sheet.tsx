"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { IconClose } from "./icons";

const SheetCtx = createContext<{ close: () => void } | null>(null);

/** Para cerrar el panel desde un formulario de adentro (p. ej. al guardar). */
export const useSheet = () => useContext(SheetCtx);

/**
 * Panel lateral que abre un botón, sin cambiar de página. Esc o el fondo lo cierran; el foco
 * entra al abrir y vuelve al botón al cerrar. `hash` lo abre al llegar con ese #ancla.
 */
export function SideSheet({
  trigger, triggerClass = "btn", title, sub, hash, children,
}: {
  trigger: React.ReactNode;
  triggerClass?: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
  hash?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (hash && window.location.hash === `#${hash}`) setOpen(true);
  }, [hash]);

  useEffect(() => {
    if (!open) return;
    const trig = button.current;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      // el foco no sale del panel con Tab
      if (e.key === "Tab" && panel.current) {
        const items = panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, select, textarea, summary");
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === panel.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      trig?.focus();
    };
  }, [open]);

  return (
    <>
      <button ref={button} type="button" className={triggerClass} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        {trigger}
      </button>
      {open && (
        <SheetCtx.Provider value={{ close }}>
          <div className="drawer-overlay" onClick={close} aria-hidden />
          <div className="drawer sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={panel}>
            <div className="drawer-head sheet-head">
              <div className="grow">
                <h2 id={titleId} className="sheet-title">{title}</h2>
                {sub && <p className="sheet-sub">{sub}</p>}
              </div>
              <button type="button" className="btn btn-ghost btn-icon" onClick={close} aria-label="Cerrar (Esc)">
                <IconClose />
              </button>
            </div>
            <div className="drawer-body sheet-body">{children}</div>
          </div>
        </SheetCtx.Provider>
      )}
    </>
  );
}
