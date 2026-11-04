"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import { IconClose, IconPlus } from "./icons";
import {
  CLIENT_KINDS, MAX_ITEMS, norm, requestAllocation, ORIGIN_SUGGESTIONS, REQUEST_STATUSES, REQUEST_TYPES, type ClientKind, type ProspectSuggestion, type RequestItem,
  type RequestStatus, type RequestType, type StoreSuggestion,
} from "@/lib/store-requests";
import { useSheet } from "./side-sheet";
import { StickyForm } from "./sticky-form";
import { SubmitButton } from "./submit-button";

type State = { ok: boolean; msg: string } | null;
type Action = (prev: State, form: FormData) => Promise<State>;

export type RequestValues = {
  id?: string; client_kind?: ClientKind; request_type?: RequestType; store_name?: string; owner_name?: string | null;
  contact_phone?: string | null; contact_email?: string | null;
  countries?: string[]; product?: string; quantity?: number; items?: RequestItem[];
  notes?: string | null; status?: RequestStatus; requested_at?: string; arrival_at?: string | null; origin_country?: string | null;
};

/** Lo que se pide por defecto: una tienda pide un producto para vender; un cliente potencial, maquila. */
const defaultType = (kind: ClientKind): RequestType => (kind === "prospect" ? "maquila" : "product");

function Msg({ state }: { state: State }) {
  if (!state) return null;
  return <p className="im-msg" data-ok={state.ok} role={state.ok ? "status" : "alert"}>{state.msg}</p>;
}

/**
 * Nueva solicitud o edición: tienda o cliente potencial (todavía no es tienda: nombre y contacto),
 * tipo de solicitud, países, productos (uno o varios, con "+ Agregar producto"), fechas y origen.
 * Al elegir una tienda que ya vende en las cuentas, completa el dueño y sus países; al elegir un
 * cliente potencial ya cargado, su contacto (si todavía están vacíos).
 */
export function RequestForm({
  action, v = {}, countries, stores, prospects = [], products, today,
}: {
  action: Action;
  v?: RequestValues;
  countries: { code: string; name: string }[];
  stores: StoreSuggestion[];
  /** Clientes potenciales ya cargados, para completar su contacto. */
  prospects?: ProspectSuggestion[];
  products: string[];
  /** Hoy (YYYY-MM-DD): fecha de solicitud por defecto y la más tardía posible. */
  today: string;
}) {
  const [state, run] = useActionState(action, null);
  const sheet = useSheet();
  const uid = useId();
  const ownerRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<ClientKind>(v.client_kind ?? "store");
  const [type, setType] = useState<RequestType>(v.request_type ?? defaultType(v.client_kind ?? "store"));
  // el tipo cambia solo con el tipo de cliente mientras nadie lo eligió a mano
  const typeTouched = useRef(!!v.request_type);
  const prospect = kind === "prospect";
  const [picked, setPicked] = useState<string[]>(v.countries ?? (countries.length === 1 ? [countries[0].code] : []));
  const [hint, setHint] = useState<string | null>(null);
  const byName = useMemo(() => new Map(stores.map((s) => [norm(s.name), s])), [stores]);
  const prospectByName = useMemo(() => new Map(prospects.map((s) => [norm(s.name), s])), [prospects]);
  const pickKind = (k: ClientKind) => {
    setKind(k);
    if (!typeTouched.current) setType(defaultType(k));
    setHint(null);
    requestAnimationFrame(() => nameRef.current?.focus());
  };
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
    if (prospect) {
      const p = prospectByName.get(norm(name));
      if (!p) return setHint(null);
      const fill: string[] = [];
      const put = (ref: React.RefObject<HTMLInputElement | null>, value: string | null, what: string) => {
        if (value && ref.current && !ref.current.value.trim()) {
          ref.current.value = value;
          fill.push(what);
        }
      };
      put(ownerRef, p.contact, "el contacto");
      put(phoneRef, p.phone ? `+${p.phone}` : null, "el teléfono");
      put(emailRef, p.email, "el correo");
      return setHint(fill.length ? `Cliente ya cargado: completé ${fill.join(", ")}.` : null);
    }
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
      <input type="hidden" name="client_kind" value={kind} />
      <div className="segmented rq-kind" role="radiogroup" aria-label="Quién lo pide">
        {CLIENT_KINDS.map((k) => (
          <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} data-on={kind === k.id || undefined} onClick={() => pickKind(k.id)}>
            {k.label}
          </button>
        ))}
      </div>
      {prospect && <p className="rq-kind-note">Todavía no es tienda: guarda su nombre y contacto para darle seguimiento a la oportunidad.</p>}
      <div className="im-grid">
        <label className="field">
          <span>{prospect ? "Cliente" : "Tienda"}</span>
          <input
            ref={nameRef} className="input" name="store_name" defaultValue={v.store_name ?? ""} maxLength={120} required list={prospect ? `${uid}-prospects` : `${uid}-stores`}
            autoComplete="off" placeholder={prospect ? "Nombre del cliente o su empresa" : "Nombre de la tienda"} onChange={(e) => onStore(e.currentTarget.value)}
          />
        </label>
        <label className="field">
          <span>{prospect ? "Contacto" : "Dueño"} <span className="hint">opcional</span></span>
          <input ref={ownerRef} className="input" name="owner_name" defaultValue={v.owner_name ?? ""} maxLength={120} autoComplete="off" placeholder={prospect ? "Persona con quien se habla" : "Nombre del dueño"} />
        </label>
        {/* contacto del cliente potencial (oculto para una tienda, pero se conserva si luego pasa a tienda) */}
        <label className="field" hidden={!prospect}>
          <span>WhatsApp o teléfono <span className="hint">opcional</span></span>
          <input ref={phoneRef} className="input" name="contact_phone" defaultValue={v.contact_phone ? `+${v.contact_phone}` : ""} maxLength={40} inputMode="tel" autoComplete="off" placeholder="+504 9999 8888" />
        </label>
        <label className="field" hidden={!prospect}>
          <span>Correo <span className="hint">opcional</span></span>
          <input ref={emailRef} className="input" name="contact_email" inputMode="email" defaultValue={v.contact_email ?? ""} maxLength={120} autoComplete="off" placeholder="cliente@correo.com" />
        </label>
        {hint && <p className="rq-hint wide" role="status">{hint}</p>}
        <label className="field wide">
          <span>Tipo de solicitud</span>
          <select className="select" name="request_type" value={type} onChange={(e) => { typeTouched.current = true; setType(e.currentTarget.value as RequestType); }}>
            {REQUEST_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <fieldset className="field wide rq-countries">
          <legend>
            Países <span className="hint">{prospect ? "opcional, si ya sabe dónde lo venderá" : "uno o varios"}</span>
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
      <datalist id={`${uid}-prospects`}>
        {prospects.map((p) => <option key={p.name} value={p.name}>{p.contact ?? undefined}</option>)}
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
