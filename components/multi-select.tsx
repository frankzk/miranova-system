"use client";

import { useId, useState } from "react";
import "./multi-select.css";

export type MultiOption = { value: string; label: string; count: number };

const fmt = (n: number) => n.toLocaleString("en-US");
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * Desplegable de selección múltiple para formularios GET (panel "Filtros"). Cada opción marcada
 * viaja como `name=valor` repetido; el filtro se aplica con el botón del formulario, no al marcar,
 * para poder elegir varias. Cada opción muestra su conteo y "Todos" quita la selección.
 * Con muchas opciones (`searchFrom`) aparece un buscador para acotar la lista.
 */
export function MultiSelect({ name, label, hint, all, allCount, options, selected, searchFrom = 9 }: {
  name: string;
  label: string;
  hint?: string;
  /** Texto de "sin filtro", p. ej. "Todos los proveedores". */
  all: string;
  allCount: number;
  options: MultiOption[];
  selected: string[];
  searchFrom?: number;
}) {
  const [sel, setSel] = useState(selected);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const id = useId();

  // al navegar (p. ej. quitar un chip) llega otra selección: se toma la nueva
  const sig = selected.join("\u0000");
  const [prev, setPrev] = useState(sig);
  if (sig !== prev) {
    setPrev(sig);
    setSel(selected);
  }

  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const summary = sel.length === 0 ? `${all} (${fmt(allCount)})` : sel.length === 1 ? labelOf(sel[0]) : `${labelOf(sel[0])} +${sel.length - 1}`;
  const q = fold(text.trim());
  const toggle = (v: string) => setSel((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));

  return (
    <div
      className="field multi"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          setOpen(false);
          document.getElementById(`${id}-t`)?.focus();
        }
      }}
    >
      <span id={`${id}-l`}>{label}{hint && <span className="hint">{hint}</span>}</span>
      <button
        id={`${id}-t`}
        type="button"
        className="select multi-trigger"
        aria-expanded={open}
        aria-controls={`${id}-p`}
        aria-labelledby={`${id}-l ${id}-t`}
        data-on={sel.length > 0 || undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="multi-sum">{summary}</span>
      </button>
      {/* oculta pero dentro del formulario: lo marcado se envía aunque la lista esté cerrada */}
      <div className="multi-pop" id={`${id}-p`} role="group" aria-labelledby={`${id}-l`} hidden={!open}>
        {options.length >= searchFrom && (
          <input
            className="input multi-find"
            type="search"
            value={text}
            placeholder="Buscar en la lista"
            aria-label={`Buscar en ${label}`}
            autoComplete="off"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault(); // Enter acota, no envía
            }}
          />
        )}
        <ul>
          <li>
            <label>
              <input type="checkbox" checked={sel.length === 0} onChange={() => setSel([])} />
              <span className="n">{all}</span>
              <span className="c">{fmt(allCount)}</span>
            </label>
          </li>
          {options.map((o) => (
            <li key={o.value} hidden={Boolean(q) && !fold(o.label).includes(q)}>
              <label data-zero={o.count === 0 || undefined}>
                <input type="checkbox" name={name} value={o.value} checked={sel.includes(o.value)} onChange={() => toggle(o.value)} />
                <span className="n" title={o.label}>{o.label}</span>
                <span className="c">{fmt(o.count)}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
