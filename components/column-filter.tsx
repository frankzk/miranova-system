"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IconCheck, IconChevronDown, IconSearch } from "./icons";

export type FilterOption = { value: string; label: string; count?: number };

/**
 * Encabezado de columna con menú de filtro u orden.
 * El menú va en `position: fixed` para que no lo recorte el scroll horizontal de la tabla.
 * `query` es la URL actual sin `param`, `page` ni `order`; cada opción navega con el cambio.
 */
export function ColumnFilter({
  label,
  param,
  options,
  current,
  allLabel,
  query,
  align = "left",
  title,
}: {
  label: string;
  param: string;
  options: FilterOption[];
  current?: string;
  /** Opción que quita el filtro (p. ej. "Todos los estados"). */
  allLabel: string;
  query: string;
  align?: "left" | "right";
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [term, setTerm] = useState("");
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const active = !!current;
  const searchable = options.length > 8;

  const href = (value: string) => {
    const p = new URLSearchParams(query);
    if (value) p.set(param, value);
    else p.delete(param);
    const s = p.toString();
    return s ? `/orders?${s}` : "/orders";
  };

  const shown = useMemo(() => {
    const t = term.trim().toLowerCase();
    return t ? options.filter((o) => o.label.toLowerCase().includes(t)) : options;
  }, [options, term]);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = 280;
    const left = align === "right" ? Math.max(8, r.right - w) : Math.min(r.left, window.innerWidth - w - 8);
    setPos({ top: r.bottom + 6, left });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        btn.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  useEffect(() => {
    if (open) setTerm("");
  }, [open]);

  const item = (value: string, text: string, count?: number) => {
    const selected = (current ?? "") === value;
    return (
      <Link key={value || "__all"} href={href(value)} role="menuitemradio" aria-checked={selected} onClick={() => setOpen(false)}>
        <span className="check" aria-hidden>{selected && <IconCheck />}</span>
        <span className="t">{text}</span>
        {count !== undefined && <span className="n">{count.toLocaleString("en-US")}</span>}
      </Link>
    );
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="colf"
        data-active={active || undefined}
        data-align={align}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        {active && <span className="dot" aria-label="filtrado" />}
        <IconChevronDown className="chev" />
      </button>
      {open && pos && (
        <div ref={menu} className="colf-menu" role="menu" aria-label={label} style={{ top: pos.top, left: pos.left }}>
          {searchable && (
            <label className="colf-search">
              <IconSearch />
              <input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Buscar…" aria-label={`Buscar en ${label}`} />
            </label>
          )}
          <div className="colf-list">
            {!term && item("", allLabel)}
            {shown.map((o) => item(o.value, o.label, o.count))}
            {shown.length === 0 && <p className="colf-empty">Sin coincidencias</p>}
          </div>
        </div>
      )}
    </>
  );
}
