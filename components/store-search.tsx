"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { IconCheck, IconClose, IconSearch } from "./icons";
import { matchesStore } from "@/lib/stores";

export type StoreOption = {
  /** `storeKey` de la tienda (cuenta + ID); va en la URL como `t`. */
  key: string;
  name: string;
  /** Cuenta, solo si hay varias (para distinguir la misma tienda en dos países). */
  account: string | null;
  /** Pedidos de los últimos 7 días (orden y dato de contexto). */
  d7: number;
};

const MAX_SHOWN = 80;

/**
 * Buscador de Salud de tiendas: al hacer clic muestra la lista de tiendas, filtra mientras se
 * escribe y permite marcar varias (quedan como etiquetas). Va dentro de un formulario GET: cada
 * tienda marcada es un `t` y el texto escrito un `q`. Sin el autocompletado del navegador.
 */
export function StoreSearch({ options, selected, q }: { options: StoreOption[]; selected: string[]; q?: string }) {
  const [text, setText] = useState(q ?? "");
  const [sel, setSel] = useState<string[]>(selected);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const byKey = useMemo(() => new Map(options.map((o) => [o.key, o])), [options]);
  const matches = useMemo(() => options.filter((o) => matchesStore(o.name, text)), [options, text]);
  const shown = matches.slice(0, MAX_SHOWN);

  // cerrar al hacer clic fuera
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // al moverse con el teclado, mantener visible la opción activa (solo desplaza la lista, no la página)
  const byKeys = useRef(false);
  useEffect(() => {
    const list = listRef.current;
    if (active < 0 || !list || !byKeys.current) return;
    byKeys.current = false;
    const el = list.querySelector<HTMLElement>(`[data-i="${active}"]`);
    if (!el) return;
    if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight;
  }, [active]);

  const toggle = (key: string) => {
    setSel((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
    // el texto solo servía para encontrarla
    setText("");
    setActive(-1);
    inputRef.current?.focus();
  };

  const submit = () => {
    setOpen(false);
    inputRef.current?.form?.requestSubmit();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (!shown.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      byKeys.current = true;
      setActive((i) => (i < 0 ? (step > 0 ? 0 : shown.length - 1) : (i + step + shown.length) % shown.length));
    } else if (e.key === "Enter") {
      // con una opción resaltada, Enter la marca; si no, busca
      if (open && active >= 0 && shown[active]) {
        e.preventDefault();
        toggle(shown[active].key);
      } else {
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActive(-1);
      }
    } else if (e.key === "Backspace" && text === "" && sel.length) {
      setSel((s) => s.slice(0, -1));
    }
  };

  const optionId = (i: number) => `${listId}-o${i}`;
  const count = sel.length;

  return (
    <div className="store-search" ref={boxRef}>
      {sel.map((k) => <input key={k} type="hidden" name="t" value={k} />)}
      <div className="store-search-box" data-open={open || undefined} onClick={() => { inputRef.current?.focus(); setOpen(true); }}>
        <IconSearch />
        {sel.map((k) => {
          const o = byKey.get(k);
          const label = o ? o.name : "Tienda";
          return (
            <span key={k} className="pick-chip" title={o?.account ? `${label} · ${o.account}` : label}>
              <span className="n">{label}</span>
              {o?.account && <span className="a">{o.account}</span>}
              <button
                type="button"
                aria-label={`Quitar ${label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setSel((s) => s.filter((x) => x !== k));
                }}
              >
                <IconClose />
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          className="store-search-input"
          type="search"
          name="q"
          value={text}
          placeholder={count ? "Agregar otra tienda" : "Buscar tienda por nombre"}
          maxLength={80}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-label="Buscar tienda"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
        />
      </div>

      {open && (
        <div className="store-search-pop">
          {shown.length > 0 ? (
            <ul ref={listRef} id={listId} role="listbox" aria-multiselectable="true" aria-label="Tiendas">
              {shown.map((o, i) => {
                const on = sel.includes(o.key);
                return (
                  <li
                    key={o.key}
                    id={optionId(i)}
                    data-i={i}
                    role="option"
                    aria-selected={on}
                    data-active={i === active || undefined}
                    onPointerDown={(e) => e.preventDefault()}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => toggle(o.key)}
                  >
                    <span className="box" aria-hidden>{on && <IconCheck />}</span>
                    <span className="n">{o.name}</span>
                    <span className="m">
                      {o.account && <>{o.account} · </>}
                      {o.d7} ped. 7 d
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="none" id={listId}>Ninguna tienda con &ldquo;{text.trim()}&rdquo;</p>
          )}
          {matches.length > shown.length && <p className="more">y {matches.length - shown.length} más: escribe para acotar</p>}
          <div className="foot">
            <span>{count ? `${count} ${count === 1 ? "elegida" : "elegidas"}` : "Puedes marcar varias"}</span>
            {count > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSel([]); inputRef.current?.focus(); }}>
                Quitar todas
              </button>
            )}
            <button type="button" className="btn btn-primary btn-sm" onClick={submit}>
              {count ? `Ver ${count === 1 ? "1 tienda" : `${count} tiendas`}` : "Buscar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
