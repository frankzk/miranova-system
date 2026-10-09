"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IconCheck, IconChevronDown, IconSearch } from "./icons";

export type FilterOption = { value: string; label: string; count?: number };

/**
 * Encabezado de columna con menú de filtro u orden.
 * El menú va en `position: fixed` para que no lo recorte el scroll horizontal de la tabla.
 * `query` es la URL actual sin `param`, `page` ni `order`; cada opción navega con el cambio.
 * Con `multiple`, cada opción tiene su casilla y se aplican varias juntas con "Aplicar"
 * (`param` repetido en la URL).
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
  path = "/orders",
  multiple = false,
}: {
  label: string;
  param: string;
  options: FilterOption[];
  current?: string | string[];
  /** Opción que quita el filtro (p. ej. "Todos los estados"). */
  allLabel: string;
  query: string;
  align?: "left" | "right";
  title?: string;
  /** Página a la que apuntan las opciones. */
  path?: string;
  /** Varias opciones a la vez (casillas + "Aplicar"). */
  multiple?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [term, setTerm] = useState("");
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const chosen = useMemo(() => (Array.isArray(current) ? current : current ? [current] : []), [current]);
  const [sel, setSel] = useState<string[]>(chosen);
  const active = chosen.length > 0;
  const searchable = options.length > 8;

  const href = (values: string[]) => {
    const p = new URLSearchParams(query);
    p.delete(param);
    for (const v of values) if (v) p.append(param, v);
    const s = p.toString();
    return s ? `${path}?${s}` : path;
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
    // el menú es fijo: se cierra si se mueve la página, pero no al desplazar su propia lista
    // (antes, cualquier scroll lo cerraba y la lista "volvía al inicio")
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && menu.current?.contains(e.target)) return;
      close();
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setTerm("");
      setSel(chosen);
    }
  }, [open, chosen]);

  const item = (value: string, text: string, count?: number) => {
    const selected = value ? chosen.includes(value) : chosen.length === 0;
    return (
      <Link key={value || "__all"} href={href([value])} role="menuitemradio" aria-checked={selected} onClick={() => setOpen(false)}>
        <span className="check" aria-hidden>{selected && <IconCheck />}</span>
        <span className="t">{text}</span>
        {count !== undefined && <span className="n">{count.toLocaleString("en-US")}</span>}
      </Link>
    );
  };

  const apply = (values: string[]) => {
    setOpen(false);
    router.push(href(values));
  };
  const toggle = (v: string) => setSel((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  const check = (value: string, text: string, count?: number) => {
    const on = value ? sel.includes(value) : sel.length === 0;
    return (
      <label key={value || "__all"} className="colf-check" data-on={on || undefined}>
        <input type="checkbox" checked={on} onChange={() => (value ? toggle(value) : setSel([]))} />
        <span className="t" title={text}>{text}</span>
        {count !== undefined && <span className="n">{count.toLocaleString("en-US")}</span>}
      </label>
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
        {active && (multiple && chosen.length > 1 ? <span className="colf-count" aria-label={`${chosen.length} seleccionados`}>{chosen.length}</span> : <span className="dot" aria-label="filtrado" />)}
        <IconChevronDown className="chev" />
      </button>
      {open && pos && (
        <div ref={menu} className="colf-menu" role={multiple ? "dialog" : "menu"} aria-label={label} style={{ top: pos.top, left: pos.left }}>
          {searchable && (
            <label className="colf-search">
              <IconSearch />
              <input
                autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Buscar…" aria-label={`Buscar en ${label}`}
                onKeyDown={(e) => {
                  // con varias, Enter aplica lo marcado
                  if (multiple && e.key === "Enter") {
                    e.preventDefault();
                    apply(sel);
                  }
                }}
              />
            </label>
          )}
          <div className="colf-list">
            {multiple ? (
              <>
                {!term && check("", allLabel)}
                {shown.map((o) => check(o.value, o.label, o.count))}
              </>
            ) : (
              <>
                {!term && item("", allLabel)}
                {shown.map((o) => item(o.value, o.label, o.count))}
              </>
            )}
            {shown.length === 0 && <p className="colf-empty">Sin coincidencias</p>}
          </div>
          {multiple && (
            <div className="colf-actions">
              <span className="colf-sum">{sel.length ? `${sel.length} seleccionad${sel.length === 1 ? "o" : "os"}` : "Ninguno marcado"}</span>
              {sel.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSel([])}>Limpiar</button>}
              <button type="button" className="btn btn-primary btn-sm" onClick={() => apply(sel)}>Aplicar</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
