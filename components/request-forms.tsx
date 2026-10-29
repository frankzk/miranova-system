"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import { IconClose, IconPlus } from "./icons";
import { MAX_ITEMS, norm, requestAllocation, ORIGIN_SUGGESTIONS, REQUEST_STATUSES, type RequestItem, type RequestStatus, type StoreSuggestion } from "@/lib/store-requests";
import { useSheet } from "./side-sheet";
import { StickyForm } from "./sticky-form";
import { SubmitButton } from "./submit-button";

type State = { ok: boolean; msg: string } | null;
type Action = (prev: State, form: FormData) => Promise<State>;

export type RequestValues = {
  id?: string; store_name?: string; owner_name?: string | null; countries?: string[]; product?: string; quantity?: number; items?: RequestItem[];
  notes?: string | null; status?: RequestStatus; requested_at?: string; arrival_at?: string | null; origin_country?: string | null;
};

function Msg({ state }: { state: State }) {
  if (!state) return null;
  return <p className="im-msg" data-ok={state.ok} role={state.ok ? "status" : "alert"}>{state.msg}</p>;
}

/**
 * Nueva solicitud o edición: tienda, dueño, países, productos (uno o varios, con "+ Agregar
 * producto"), fechas y origen. Al elegir una tienda que ya vende en las cuentas, completa el dueño
 * y sus países (si todavía están vacíos).
 */
export function RequestForm({
  action, v = {}, countries, stores, products, today,
}: {
  action: Action;
  v?: RequestValues;
  countries: { code: string; name: string }[];
  stores: StoreSuggestion[];
  products: string[];
  /** Hoy (YYYY-MM-DD): fecha de solicitud por defecto y la más tardía posible. */
  today: string;
}) {
  const [state, run] = useActionState(action, null);
  const sheet = useSheet();
  const uid = useId();
  const ownerRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<string[]>(v.countries ?? (countries.length === 1 ? [countries[0].code] : []));
  const [hint, setHint] = useState<string | null>(null);
  const byName = useMemo(() => new Map(stores.map((s) => [norm(s.name), s])), [stores]);
  const codes = countries.map((c) => c.code);
  const all = codes.length > 1 && codes.every((c) => picked.includes(c));
  // filas de producto: no controladas (cada una con su clave); el total se recalcula al escribir
  const seq = useRef(0);
  const first = v.items?.length ? v.items : v.product ? [{ product: v.product, quantity: v.quantity ?? 0 }] : [{ product: "", quantity: 0 }];
  const [lines, setLines] = useState(() => first.map((it) => ({ key: seq.current++, product: it.product, quantity: it.quantity ? String(it.quantity) : "", allocation: Object.fromEntries(Object.entries(requestAllocation(it, v.countries ?? picked)).map(([c, n]) => [c, String(n)])) })));
  const linesRef = useRef<HTMLDivElement>(null);
  const [total, setTotal] = useState(() => first.reduce((t, it) => t + (it.quantity || 0), 0));
  const recount = () => {
    const inputs = linesRef.current?.querySelectorAll<HTMLInputElement>('input[name="quantity"]') ?? [];
    setTotal([...inputs].reduce((t, i) => t + (Number(i.value.replace(/[,\s]/g, "")) || 0), 0));
  };
  useEffect(recount, [lines.length]);
  const addLine = () => {
    setLines((l) => (l.length >= MAX_ITEMS ? l : [...l, { key: seq.current++, product: "", quantity: "", allocation: {} }]));
    // el foco va al producto de la fila nueva
    requestAnimationFrame(() => linesRef.current?.querySelector<HTMLInputElement>('.rq-line:last-child input[name="product"]')?.focus());
  };

  useEffect(() => {
    if (state?.ok) sheet?.close();
  }, [state, sheet]);

  const onStore = (name: string) => {
    const s = byName.get(norm(name));
    if (!s) return setHint(null);
    const fill: string[] = [];
    if (s.owner && ownerRef.current && !ownerRef.current.value.trim()) {
      ownerRef.current.value = s.owner;
      fill.push("el dueño");
    }
    const theirs = codes.filter((c) => s.countries.includes(c));
    if (theirs.length && picked.length === 0) {
      setPicked(theirs);
      fill.push(theirs.length === 1 ? "su país" : "sus países");
    }
    setHint(fill.length ? `Tienda conocida: completé ${fill.join(" y ")}.` : null);
  };
  const toggle = (code: string) => setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : codes.filter((c) => c === code || p.includes(c))));

  return (
    <StickyForm state={state} action={run} className="im-form rq-form">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <div className="im-grid">
        <label className="field">
          <span>Tienda</span>
          <input
            className="input" name="store_name" defaultValue={v.store_name ?? ""} maxLength={120} required list={`${uid}-stores`} autoComplete="off"
            placeholder="Nombre de la tienda" onChange={(e) => onStore(e.currentTarget.value)}
          />
        </label>
        <label className="field">
          <span>Dueño <span className="hint">opcional</span></span>
          <input ref={ownerRef} className="input" name="owner_name" defaultValue={v.owner_name ?? ""} maxLength={120} autoComplete="off" placeholder="Nombre del dueño" />
        </label>
        {hint && <p className="rq-hint wide" role="status">{hint}</p>}
        <fieldset className="field wide rq-countries">
          <legend>
            Países <span className="hint">uno o varios</span>
            {codes.length > 1 && (
              <button type="button" className="rq-all" onClick={() => setPicked(all ? [] : codes)}>{all ? "Quitar todos" : `Los ${codes.length}`}</button>
            )}
          </legend>
          <div className="rq-country-list">
            {countries.map((c) => (
              <label key={c.code} className="rq-country" data-on={picked.includes(c.code) || undefined}>
                <input type="checkbox" name="countries" value={c.code} checked={picked.includes(c.code)} onChange={() => toggle(c.code)} />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="field wide rq-lines">
          <legend>
            {lines.length > 1 ? `Productos (${lines.length})` : "Producto"}
            {lines.length > 1 && <span className="hint">{total.toLocaleString("en-US")} unidades en total</span>}
          </legend>
          <div className="rq-line-head" aria-hidden>
            <span>Producto</span>
            <span>Cantidad <span className="hint">unidades</span></span>
          </div>
          <div ref={linesRef} onInput={recount}>
            {lines.map((l, i) => (
              <div key={l.key} className="rq-line-block"><div className="rq-line">
                <input
                  className="input" name="product" defaultValue={l.product} maxLength={160} required={i === 0} list={`${uid}-products`} autoComplete="off"
                  placeholder={i === 0 ? "Ej.: Drenaje linfático en gotas" : "Otro producto"} aria-label={`Producto ${i + 1}`}
                />
                <input
                  className="input" name="quantity" defaultValue={l.quantity} inputMode="numeric" pattern="[0-9][0-9,]*" required={i === 0}
                  placeholder="500" aria-label={`Cantidad del producto ${i + 1}`}
                />
                {lines.length > 1 ? (
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Quitar el producto ${i + 1}`} title="Quitar este producto"
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                    <IconClose />
                  </button>
                ) : <span aria-hidden />}
              </div>
                <input type="hidden" name="country_quantities" value={JSON.stringify(picked.length > 1 ? Object.fromEntries(Object.entries(l.allocation).filter(([c]) => picked.includes(c))) : {})} />
                {picked.length > 1 && <fieldset className="rq-allocation"><legend>Reparto del producto {i + 1} por país</legend>
                  <div className="rq-allocation-fields">{countries.filter((c) => picked.includes(c.code)).map((c) => <label className="field" key={c.code}>
                    <span>{c.name}</span><input className="input" inputMode="numeric" pattern="[0-9][0-9,]*" placeholder="0"
                      aria-label={`${c.name}, producto ${i + 1}`} value={l.allocation[c.code] ?? ""}
                      onChange={(e) => { const value = e.currentTarget.value; setLines((ls) => ls.map((x) => x.key === l.key ? { ...x, allocation: { ...x.allocation, [c.code]: value } } : x)); }} />
                  </label>)}</div>
                  <p className="hint">Total repartido: {Object.entries(l.allocation).filter(([c]) => picked.includes(c)).reduce((sum, [, n]) => sum + (Number(n.replace(/[,\s]/g, "")) || 0), 0).toLocaleString("en-US")} u. Puede quedar pendiente, pero no superar lo solicitado.</p>
                </fieldset>}
              </div>
            ))}
          </div>
          {lines.length < MAX_ITEMS && (
            <button type="button" className="btn btn-ghost btn-sm rq-add" onClick={addLine}>
              <IconPlus /> Agregar producto
            </button>
          )}
        </fieldset>
        <label className="field">
          <span>País de origen <span className="hint">opcional</span></span>
          <input className="input" name="origin_country" defaultValue={v.origin_country ?? ""} maxLength={60} list={`${uid}-origins`} autoComplete="off" placeholder="Ej.: China" />
        </label>
        <label className="field">
          <span>Fecha de solicitud</span>
          <input className="input" type="date" name="requested_at" defaultValue={v.requested_at ?? today} max={today} required />
        </label>
        <label className="field">
          <span>Fecha de llegada <span className="hint">opcional</span></span>
          <input className="input" type="date" name="arrival_at" defaultValue={v.arrival_at ?? ""} />
        </label>
        {v.id && (
          <label className="field">
            <span>Estado</span>
            <select className="select" name="status" defaultValue={v.status ?? "pending"}>
              {REQUEST_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        )}
        <label className="field wide">
          <span>Notas <span className="hint">opcional</span></span>
          <textarea className="input" name="notes" rows={3} defaultValue={v.notes ?? ""} maxLength={2000} placeholder="Para cuándo lo necesita, precio que espera, presentación…" />
        </label>
      </div>
      <datalist id={`${uid}-stores`}>
        {stores.map((s) => <option key={s.name} value={s.name}>{s.owner ?? undefined}</option>)}
      </datalist>
      <datalist id={`${uid}-products`}>
        {products.map((p) => <option key={p} value={p} />)}
      </datalist>
      <datalist id={`${uid}-origins`}>
        {ORIGIN_SUGGESTIONS.map((o) => <option key={o} value={o} />)}
      </datalist>
      <Msg state={state} />
      <SubmitButton className="btn btn-primary" pending="Guardando…">{v.id ? "Guardar" : "Guardar solicitud"}</SubmitButton>
    </StickyForm>
  );
}

/** Estado desde la lista: se guarda al elegirlo. */
export function RequestStatusSelect({ action, id, status }: { action: Action; id: string; status: RequestStatus }) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="rq-status">
      <input type="hidden" name="id" value={id} />
      <select
        className="select" name="status" defaultValue={status} disabled={pending} aria-label="Estado de la solicitud"
        data-status={status} onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {REQUEST_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      {state && !state.ok && <p className="im-msg" data-ok="false" role="alert">{state.msg}</p>}
    </form>
  );
}

export function DeleteRequestForm({ action, id, label }: { action: Action; id: string; label: string }) {
  const [state, run] = useActionState(action, null);
  const sheet = useSheet();
  useEffect(() => {
    if (state?.ok) sheet?.close();
  }, [state, sheet]);
  return (
    <StickyForm state={state} action={run} className="im-inline" onSubmit={(e) => { if (!window.confirm(`¿Borrar la solicitud de ${label}?`)) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton className="btn btn-ghost btn-sm btn-danger" pending="Borrando…">Borrar solicitud</SubmitButton>
      <Msg state={state} />
    </StickyForm>
  );
}
