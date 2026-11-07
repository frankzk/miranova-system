"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRequestProduct, linkRequestProduct, searchDropProducts, startRequestPhotoUpload } from "@/app/(app)/requests/actions";
import { IconClose, IconPlus, IconUpload } from "./icons";
import {
  CLIENT_KINDS, cleanProductName, MAX_ITEMS, norm, requestAllocation, ORIGIN_SUGGESTIONS, REQUEST_STATUSES, REQUEST_TYPES, requestPhotoProblem, type ClientKind,
  type DropProductRef, type ProspectSuggestion, type RequestItem, type RequestProduct, type RequestStatus, type RequestType, type StoreSuggestion,
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

/** Sube la foto al enlace firmado de Storage (mismo formato que las fotos de las importaciones). */
async function put(url: string, file: File, type: string): Promise<void> {
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", file.type === type ? file : new File([file], file.name, { type }));
  const res = await fetch(url, { method: "PUT", body, headers: { "x-upsert": "false" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/**
 * Ventana sobre la página o el panel. Va fuera del formulario (portal) para no anidar formularios;
 * Esc la cierra sin cerrar el panel de atrás y Tab no sale de ella.
 */
function Popup({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("input:not([type=file]), button")?.focus();
    return () => back?.focus();
  }, []);
  return createPortal(
    <div className="im-pop-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={box}
        className={wide ? "im-pop rq-pop rq-pop-wide" : "im-pop rq-pop"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          // que el panel de atrás no reciba Esc ni Tab
          if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); onClose(); }
          if (e.key === "Tab" && box.current) {
            e.stopPropagation();
            const items = box.current.querySelectorAll<HTMLElement>("input, button:not([disabled])");
            const first = items[0], last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          }
        }}
      >
        <h3 id={titleId}>{title}</h3>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Crear un producto que todavía no existe en Drop: nombre (obligatorio) y foto (opcional). Si ya hay
 * uno con ese nombre, se usa ese (y la foto elegida queda como su foto).
 */
function NewProductPopup({ initial, onClose, onCreated }: { initial: string; onClose: () => void; onCreated: (name: string, msg: string) => void }) {
  const [name, setName] = useState(initial);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const pick = (f: File | null) => {
    setErr(null);
    const problem = f ? requestPhotoProblem(f.type, f.name, f.size) : null;
    if (!f || problem) {
      if (fileRef.current) fileRef.current.value = "";
      setFile(null);
      setPreview(null);
      if (problem) setErr(problem);
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };
  async function save() {
    if (busy) return;
    const clean = cleanProductName(name);
    if (!clean) return setErr("Escribe el nombre del producto.");
    setErr(null);
    try {
      let photo_path: string | null = null;
      if (file) {
        setBusy("Subiendo la foto…");
        const up = await startRequestPhotoUpload(file.name, file.type, file.size);
        if (!up.ok) return setErr(up.msg);
        await put(up.url, file, up.type);
        photo_path = up.path;
      }
      setBusy("Guardando…");
      const r = await createRequestProduct({ name: clean, photo_path });
      if (!r.ok) return setErr(r.msg);
      onCreated(
        r.product.name,
        r.existed
          ? `Ya existía el producto “${r.product.name}”: quedó en la solicitud${photo_path ? " con la foto nueva" : ""}.`
          : `Producto nuevo “${r.product.name}” creado y agregado a la solicitud.`,
      );
    } catch {
      setErr("No se pudo guardar. Revisa la conexión e inténtalo de nuevo.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <Popup title="Producto nuevo" onClose={onClose}>
      <p className="im-pop-hint">Para lo que pide el cliente y todavía no está en Drop. Más adelante lo vinculas con el producto de Drop desde «Lo más pedido».</p>
      <label className="field">
        <span>Nombre</span>
        <input
          className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} autoComplete="off" placeholder="Ej.: Crema hidratante NIDA 100 ml"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
        />
      </label>
      <div className="field">
        <span>Foto <span className="hint">opcional · JPG, PNG o WEBP de hasta 10 MB</span></span>
        <div className="rq-photo-pick">
          {preview ? <img className="rq-photo-preview" src={preview} alt="Foto elegida" /> : <span className="rq-photo-empty" aria-hidden><IconUpload /></span>}
          <label className="btn btn-sm">
            {file ? "Cambiar foto" : "Elegir foto"}
            <input ref={fileRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => pick(e.currentTarget.files?.[0] ?? null)} />
          </label>
          {file && <button type="button" className="btn btn-ghost btn-sm" onClick={() => pick(null)}>Quitar</button>}
        </div>
      </div>
      {err && <p className="im-msg" data-ok="false" role="alert">{err}</p>}
      <div className="im-pop-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={!!busy}>Cancelar</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={!!busy || !name.trim()}>{busy ?? "Crear producto"}</button>
      </div>
    </Popup>
  );
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
  // productos nuevos creados desde este formulario (para la lista de sugerencias) y la ventana
  const [extra, setExtra] = useState<string[]>([]);
  const [creating, setCreating] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    return [...extra, ...products].filter((p) => !seen.has(norm(p)) && !!seen.add(norm(p)));
  }, [extra, products]);
  // a dónde va el foco cuando se cierra la ventana (después de que ella lo devuelva al botón)
  const focusAfter = useRef<(() => HTMLElement | null | undefined) | null>(null);
  useEffect(() => {
    if (creating !== null || !focusAfter.current) return;
    focusAfter.current()?.focus();
    focusAfter.current = null;
  }, [creating, lines.length]);
  const productInputs = () => [...(linesRef.current?.querySelectorAll<HTMLInputElement>('input[name="product"]') ?? [])];
  const openNew = () => {
    // si ya escribió un producto que no está en la lista, se propone ese nombre
    const known = new Set(suggestions.map(norm));
    const typed = productInputs().map((i) => i.value.trim()).filter((v) => v && !known.has(norm(v)));
    setCreated(null);
    setCreating(typed.at(-1) ?? "");
  };
  const onCreated = (name: string, msg: string) => {
    setCreating(null);
    setExtra((x) => (x.some((n) => norm(n) === norm(name)) ? x : [name, ...x]));
    // va en la fila donde se escribió, o en la primera vacía, o en una fila nueva
    const inputs = productInputs();
    const target = inputs.find((i) => norm(i.value) === norm(name)) ?? inputs.find((i) => !i.value.trim());
    if (target) {
      target.value = name;
      focusAfter.current = () => target.closest(".rq-line")?.querySelector<HTMLInputElement>('input[name="quantity"]');
    } else if (lines.length < MAX_ITEMS) {
      setLines((l) => [...l, { key: seq.current++, product: name, quantity: "", allocation: {} }]);
      focusAfter.current = () => linesRef.current?.querySelector<HTMLInputElement>('.rq-line-block:last-child input[name="quantity"]');
    } else {
      msg = `Producto “${name}” guardado, pero la solicitud ya tiene ${MAX_ITEMS} productos: quita uno para agregarlo.`;
    }
    setCreated(msg);
  };
  const recount = () => {
    const inputs = linesRef.current?.querySelectorAll<HTMLInputElement>('input[name="quantity"]') ?? [];
    setTotal([...inputs].reduce((t, i) => t + (Number(i.value.replace(/[,\s]/g, "")) || 0), 0));
  };
  useEffect(recount, [lines.length]);
  const addLine = () => {
    setLines((l) => (l.length >= MAX_ITEMS ? l : [...l, { key: seq.current++, product: "", quantity: "", allocation: {} }]));
    // el foco va al producto de la fila nueva
    requestAnimationFrame(() => linesRef.current?.querySelector<HTMLInputElement>('.rq-line-block:last-child input[name="product"]')?.focus());
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
                  placeholder={i === 0 ? "Escribe el producto o elígelo de la lista" : "Otro producto"} aria-label={`Producto ${i + 1}`}
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
          <div className="rq-line-actions">
            {lines.length < MAX_ITEMS && (
              <button type="button" className="btn btn-ghost btn-sm rq-add" onClick={addLine}>
                <IconPlus /> Agregar producto
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm rq-add" onClick={openNew} aria-haspopup="dialog" title="Para un producto que todavía no está en Drop">
              <IconPlus /> Crear producto nuevo
            </button>
          </div>
          {created && <p className="rq-hint" role="status">{created}</p>}
          {creating !== null && <NewProductPopup initial={creating} onClose={() => setCreating(null)} onCreated={onCreated} />}
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
        {suggestions.map((p) => <option key={p} value={p} />)}
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

/**
 * Vincular un producto nuevo con el producto de Drop (cuando ya existe): se busca por nombre o SKU
 * en el catálogo de todas las cuentas. Si ya está vinculado, se puede cambiar o desvincular.
 */
export function LinkDropProduct({ product }: { product: RequestProduct }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm rq-link-btn" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {product.linked ? "Cambiar" : "Vincular con Drop"}
      </button>
      {open && <LinkPopup product={product} onClose={() => setOpen(false)} />}
    </>
  );
}

function LinkPopup({ product, onClose }: { product: RequestProduct; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DropProductRef[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const turn = useRef(0);
  const term = q.trim();
  useEffect(() => {
    const n = ++turn.current;
    if (term.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchDropProducts(term);
        if (n !== turn.current) return;
        if (r.ok) {
          setResults(r.results);
          setErr(null);
        } else setErr(r.msg);
      } catch {
        if (n === turn.current) setErr("No se pudo buscar. Revisa la conexión e inténtalo de nuevo.");
      } finally {
        if (n === turn.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [term]);
  async function link(target: { account_id: string; external_id: string } | null) {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await linkRequestProduct(product.id, target);
      if (r.ok) onClose();
      else setErr(r.msg);
    } catch {
      setErr("No se pudo guardar. Revisa la conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }
  const same = (p: DropProductRef) => product.linked?.account_id === p.account_id && product.linked?.external_id === p.external_id;
  return (
    <Popup title={`Vincular “${product.name}” con Drop`} onClose={onClose} wide>
      {product.linked && (
        <div className="rq-linked-now">
          <span className="grow">Ahora: <strong>{product.linked.name}</strong>{product.linked.account_name ? ` · ${product.linked.account_name}` : ""}</span>
          <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => link(null)} disabled={busy}>Desvincular</button>
        </div>
      )}
      <label className="field">
        <span>Busca el producto en Drop</span>
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} autoComplete="off" placeholder="Nombre o SKU" />
      </label>
      <div className="rq-drop-results" aria-live="polite" aria-busy={searching}>
        {term.length < 2 ? (
          <p className="im-pop-hint">Escribe al menos 2 letras del nombre o del SKU. Busca en el catálogo de todas las cuentas.</p>
        ) : results === null ? (
          <p className="im-pop-hint">Buscando…</p>
        ) : results.length === 0 ? (
          <p className="im-pop-hint">{searching ? "Buscando…" : `Nada en el catálogo de Drop con “${term}”.`}</p>
        ) : (
          results.map((p) => (
            <button
              type="button" key={`${p.account_id}:${p.external_id}`} className="rq-drop-result" data-on={same(p) || undefined} disabled={busy || same(p)}
              onClick={() => link({ account_id: p.account_id, external_id: p.external_id })}
            >
              {p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <span className="rq-thumb-empty" aria-hidden />}
              <span className="grow">
                <span className="strong">{p.name}</span>
                <span className="sub">{[p.account_name, p.sku].filter(Boolean).join(" · ")}{same(p) ? " · vinculado" : ""}</span>
              </span>
            </button>
          ))
        )}
      </div>
      {err && <p className="im-msg" data-ok="false" role="alert">{err}</p>}
      <div className="im-pop-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </div>
    </Popup>
  );
}
