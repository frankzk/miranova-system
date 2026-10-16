"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import { norm, REQUEST_STATUSES, type RequestStatus, type StoreSuggestion } from "@/lib/store-requests";
import { useSheet } from "./side-sheet";
import { StickyForm } from "./sticky-form";
import { SubmitButton } from "./submit-button";

type State = { ok: boolean; msg: string } | null;
type Action = (prev: State, form: FormData) => Promise<State>;

export type RequestValues = {
  id?: string; store_name?: string; owner_name?: string | null; countries?: string[]; product?: string; quantity?: number;
  notes?: string | null; status?: RequestStatus;
};

function Msg({ state }: { state: State }) {
  if (!state) return null;
  return <p className="im-msg" data-ok={state.ok} role={state.ok ? "status" : "alert"}>{state.msg}</p>;
}

/**
 * Nueva solicitud o edición: tienda, dueño, países, producto y cantidad. Al elegir una tienda que
 * ya vende en las cuentas, completa el dueño y sus países (si todavía están vacíos).
 */
export function RequestForm({
  action, v = {}, countries, stores, products,
}: {
  action: Action;
  v?: RequestValues;
  countries: { code: string; name: string }[];
  stores: StoreSuggestion[];
  products: string[];
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
        <label className="field wide">
          <span>Producto</span>
          <input
            className="input" name="product" defaultValue={v.product ?? ""} maxLength={160} required list={`${uid}-products`} autoComplete="off"
            placeholder="Ej.: Drenaje linfático en gotas"
          />
        </label>
        <label className="field">
          <span>Cantidad <span className="hint">unidades</span></span>
          <input className="input" name="quantity" defaultValue={v.quantity ?? ""} inputMode="numeric" pattern="[0-9][0-9,]*" required placeholder="500" />
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
