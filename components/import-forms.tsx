"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { registerImportDocument, startImportUpload } from "@/app/(app)/imports/actions";
import {
  ALLOCATIONS, CARRIERS, COST_KINDS, DOC_KINDS, IMPORT_FILE_ACCEPT, IMPORT_STATUSES, importFileProblem, MONEY_DOCS, PAYMENT_METHODS, TRANSPORTS, type DocKind,
} from "@/lib/imports";
import { IconCheck, IconCopy, IconUpload } from "./icons";
import { useSheet } from "./side-sheet";
import { SubmitButton } from "./submit-button";

export type ImportFormState = { ok: boolean; msg: string } | null;
type Action = (prev: ImportFormState, form: FormData) => Promise<ImportFormState>;

function Msg({ state }: { state: ImportFormState }) {
  if (!state) return null;
  return <p className="im-msg" data-ok={state.ok} role={state.ok ? "status" : "alert"}>{state.msg}</p>;
}

/** Cierra el panel lateral al guardar bien. */
function useCloseOnOk(state: ImportFormState) {
  const sheet = useSheet();
  useEffect(() => {
    if (state?.ok) sheet?.close();
  }, [state, sheet]);
}

/** Sube un archivo al enlace firmado de Storage (mismo formato que las fotos de productos). */
async function put(url: string, file: File, type: string): Promise<void> {
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", file.type === type ? file : new File([file], file.name, { type }));
  const res = await fetch(url, { method: "PUT", body, headers: { "x-upsert": "false" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

type Country = { code: string; name: string };

// ─── Datos generales y transporte ───

export type ImportHeader = {
  id?: string;
  supplier?: string | null;
  origin?: string | null;
  dest_country?: string;
  ordered_at?: string | null;
  eta?: string | null;
  arrived_at?: string | null;
  transport?: string;
  carrier?: string | null;
  tracking_number?: string | null;
  tracking_url?: string | null;
  weight_kg?: number | null;
  notes?: string | null;
};

function HeaderFields({ v, countries, edit }: { v: ImportHeader; countries: Country[]; edit: boolean }) {
  return (
    <div className="im-grid">
      <label className="field">
        <span>Proveedor</span>
        <input className="input" name="supplier" defaultValue={v.supplier ?? ""} maxLength={120} placeholder="Nombre del proveedor" />
      </label>
      <label className="field">
        <span>Origen <span className="hint">país o ciudad</span></span>
        <input className="input" name="origin" defaultValue={v.origin ?? ""} maxLength={80} placeholder="China, Yiwu…" />
      </label>
      <label className="field">
        <span>Llega a</span>
        <select className="select" name="dest_country" defaultValue={v.dest_country ?? ""} required>
          <option value="" disabled>Elige el país</option>
          {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Transporte</span>
        <select className="select" name="transport" defaultValue={v.transport ?? "courier"}>
          {TRANSPORTS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Empresa de transporte</span>
        <input className="input" name="carrier" list="im-carriers" defaultValue={v.carrier ?? ""} maxLength={60} placeholder="DHL, FedEx, UPS…" />
        <datalist id="im-carriers">{CARRIERS.map((c) => <option key={c.name} value={c.name} />)}</datalist>
      </label>
      <label className="field">
        <span>Número de guía</span>
        <input className="input" name="tracking_number" defaultValue={v.tracking_number ?? ""} maxLength={80} spellCheck={false} />
      </label>
      <label className="field">
        <span>Fecha del pedido</span>
        <input className="input" type="date" name="ordered_at" defaultValue={v.ordered_at ?? ""} />
      </label>
      <label className="field">
        <span>Llegada estimada</span>
        <input className="input" type="date" name="eta" defaultValue={v.eta ?? ""} />
      </label>
      {edit && (
        <>
          <label className="field">
            <span>Llegó el</span>
            <input className="input" type="date" name="arrived_at" defaultValue={v.arrived_at ?? ""} />
          </label>
          <label className="field">
            <span>Peso total <span className="hint">kg</span></span>
            <input className="input" name="weight_kg" inputMode="decimal" defaultValue={v.weight_kg ?? ""} />
          </label>
          <label className="field wide">
            <span>Enlace de seguimiento <span className="hint">solo si la empresa no es DHL, FedEx, UPS, USPS o Aramex</span></span>
            <input className="input" name="tracking_url" type="url" defaultValue={v.tracking_url ?? ""} placeholder="https://…" />
          </label>
        </>
      )}
      <label className="field wide">
        <span>Notas</span>
        <textarea className="input" name="notes" rows={2} defaultValue={v.notes ?? ""} maxLength={2000} />
      </label>
    </div>
  );
}

export function NewImportForm({ action, countries, defaultCountry }: { action: Action; countries: Country[]; defaultCountry: string }) {
  const [state, run] = useActionState(action, null);
  return (
    <form action={run} className="im-form">
      <HeaderFields v={{ dest_country: defaultCountry, transport: "courier", ordered_at: new Date().toISOString().slice(0, 10) }} countries={countries} edit={false} />
      <Msg state={state} />
      <SubmitButton className="btn btn-primary" pending="Creando…">Crear importación</SubmitButton>
    </form>
  );
}

export function ImportHeaderForm({ action, v, countries }: { action: Action; v: ImportHeader; countries: Country[] }) {
  const [state, run] = useActionState(action, null);
  useCloseOnOk(state);
  return (
    <form action={run} className="im-form">
      <input type="hidden" name="id" value={v.id} />
      <HeaderFields v={v} countries={countries} edit />
      <Msg state={state} />
      <SubmitButton className="btn btn-primary" pending="Guardando…">Guardar</SubmitButton>
    </form>
  );
}

// ─── Estado y aviso a la bodega ───

export function StatusForm({ action, importId, current }: { action: Action; importId: string; current: string }) {
  const [state, run] = useActionState(action, null);
  return (
    <form action={run} className="im-status-form">
      <input type="hidden" name="id" value={importId} />
      <label className="field">
        <span>Estado</span>
        <select className="select" name="status" defaultValue={current} key={current}>
          {IMPORT_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      <label className="field grow">
        <span>Nota <span className="hint">opcional</span></span>
        <input className="input" name="note" maxLength={500} placeholder="Ej.: salió de Shenzhen, en revisión de aduana…" />
      </label>
      <SubmitButton className="btn" pending="Guardando…">Guardar</SubmitButton>
      <Msg state={state} />
    </form>
  );
}

export function ReportBox({ action, importId, reported, who, message }: { action: Action; importId: string; reported: string | null; who: string | null; message: string }) {
  const [state, run] = useActionState(action, null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copia el mensaje:", message);
    }
  };
  return (
    <div className="im-report">
      <div className="im-report-actions">
        <button type="button" className="btn" onClick={copy}>{copied ? <><IconCheck /> Copiado</> : <><IconCopy /> Copiar mensaje</>}</button>
        <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">Abrir WhatsApp</a>
        <form action={run}>
          <input type="hidden" name="id" value={importId} />
          <input type="hidden" name="reported" value={reported ? "0" : "1"} />
          <SubmitButton className={reported ? "btn btn-ghost" : "btn btn-primary"} pending="Guardando…">
            {reported ? "Quitar marca" : "Marcar como reportada"}
          </SubmitButton>
        </form>
      </div>
      {reported && <p className="im-report-ok"><IconCheck /> Reportada {who ? `por ${who} ` : ""}el {new Date(reported).toLocaleDateString("es-HN", { day: "numeric", month: "short", year: "numeric" })}</p>}
      {/* al marcar bien, la línea de arriba ya lo dice: solo se muestran los errores */}
      {state && !state.ok && <Msg state={state} />}
    </div>
  );
}

// ─── Productos ───

export type Choice = { account_id: string; external_id: string; name: string; sku: string | null; image_url: string | null; price_usd: number | null };

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Buscar y elegir un producto del catálogo de Drop (manda account_id y product_id). */
function CatalogPicker({ choices, pick, setPick, initial = "", empty }: { choices: Choice[]; pick: Choice | null; setPick: (c: Choice | null) => void; initial?: string; empty: string }) {
  const [q, setQ] = useState(initial);
  const shown = useMemo(() => {
    const t = fold(q.trim());
    const words = t.split(/\s+/).filter(Boolean);
    const list = words.length ? choices.filter((c) => { const h = fold(`${c.name} ${c.sku ?? ""}`); return words.every((w) => h.includes(w)); }) : choices;
    return list.slice(0, 40);
  }, [choices, q]);
  return (
    <div className="im-pick">
      <input type="hidden" name="account_id" value={pick?.account_id ?? ""} />
      <input type="hidden" name="product_id" value={pick?.external_id ?? ""} />
      {pick ? (
        <div className="im-picked">
          {pick.image_url ? <img src={pick.image_url} alt="" loading="lazy" /> : <span className="im-noimg" aria-hidden />}
          <div className="grow"><b>{pick.name}</b>{pick.sku && <span>SKU {pick.sku}</span>}</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPick(null)}>Cambiar</button>
        </div>
      ) : (
        <>
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o SKU" aria-label="Buscar producto del catálogo" autoComplete="off" />
          <ul className="im-choices" role="listbox" aria-label="Productos del catálogo">
            {shown.map((c) => (
              <li key={`${c.account_id}:${c.external_id}`}>
                <button type="button" role="option" aria-selected={false} onClick={() => setPick(c)}>
                  {c.image_url ? <img src={c.image_url} alt="" loading="lazy" /> : <span className="im-noimg" aria-hidden />}
                  <span className="grow"><b>{c.name}</b>{c.sku && <span>SKU {c.sku}</span>}</span>
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="im-empty">{empty}</li>}
          </ul>
        </>
      )}
    </div>
  );
}

function ItemNumbers({ money, v }: { money: boolean; v?: { qty?: number; unit_cost?: number; unit_weight_kg?: number | null; sale_price_usd?: number | null }; }) {
  return (
    <div className="im-grid">
      <label className="field">
        <span>Cantidad</span>
        <input className="input" name="qty" type="number" min={1} step={1} inputMode="numeric" required defaultValue={v?.qty} />
      </label>
      {money && (
        <label className="field">
          <span>Costo por unidad <span className="hint">USD, del proveedor</span></span>
          <input className="input" name="unit_cost" inputMode="decimal" defaultValue={v?.unit_cost ?? ""} placeholder="0.00" />
        </label>
      )}
      <label className="field">
        <span>Peso por unidad <span className="hint">kg, opcional</span></span>
        <input className="input" name="unit_weight_kg" inputMode="decimal" defaultValue={v?.unit_weight_kg ?? ""} placeholder="0.25" />
      </label>
      {money && (
        <label className="field">
          <span>Precio de venta <span className="hint">USD, si no se toma de Drop</span></span>
          <input className="input" name="sale_price_usd" inputMode="decimal" defaultValue={v?.sale_price_usd ?? ""} />
        </label>
      )}
    </div>
  );
}

export function AddItemForm({ action, importId, choices, money }: { action: Action; importId: string; choices: Choice[]; money: boolean }) {
  const [state, run] = useActionState(action, null);
  const [source, setSource] = useState<"catalog" | "new">(choices.length ? "catalog" : "new");
  const [pick, setPick] = useState<Choice | null>(null);
  const [photo, setPhoto] = useState<{ path: string; preview: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [upErr, setUpErr] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state?.ok) return;
    form.current?.reset();
    setPick(null);
    setPhoto(null);
    setRound((r) => r + 1); // limpia la búsqueda
  }, [state]);

  async function upload(file: File) {
    setUpErr(null);
    const problem = importFileProblem(file.type, file.name, file.size, true);
    if (problem) return setUpErr(problem);
    setUploading(true);
    try {
      const start = await startImportUpload(importId, "items", "photo", file.name, file.type, file.size);
      if (!start.ok) return setUpErr(start.msg);
      await put(start.url, file, start.type);
      setPhoto({ path: start.path, preview: URL.createObjectURL(file) });
    } catch {
      setUpErr("No se pudo subir la foto. Revisa la conexión e inténtalo de nuevo.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form ref={form} action={run} className="im-form">
      <input type="hidden" name="id" value={importId} />
      <input type="hidden" name="source" value={source} />
      <div className="segmented im-source" role="tablist" aria-label="Qué producto">
        <button type="button" role="tab" aria-selected={source === "catalog"} data-on={source === "catalog" || undefined} onClick={() => setSource("catalog")} disabled={!choices.length}>Del catálogo</button>
        <button type="button" role="tab" aria-selected={source === "new"} data-on={source === "new" || undefined} onClick={() => setSource("new")}>Producto nuevo</button>
      </div>

      {source === "catalog" ? (
        <CatalogPicker key={round} choices={choices} pick={pick} setPick={setPick} empty="Nada con esa búsqueda. ¿Es un producto nuevo?" />
      ) : (
        <div className="im-grid">
          <label className="field wide">
            <span>Nombre del producto</span>
            <input className="input" name="name" maxLength={200} required={source === "new"} />
          </label>
          <label className="field">
            <span>SKU <span className="hint">opcional</span></span>
            <input className="input" name="sku" maxLength={80} spellCheck={false} />
          </label>
          <div className="field">
            <span>Foto <span className="hint">opcional</span></span>
            <input type="hidden" name="photo_path" value={photo?.path ?? ""} />
            <div className="im-photo">
              {photo ? <img src={photo.preview} alt="Foto del producto nuevo" /> : <span className="im-noimg" aria-hidden />}
              <label className="btn btn-sm">
                <IconUpload /> {uploading ? "Subiendo…" : photo ? "Cambiar foto" : "Subir foto"}
                <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
              </label>
            </div>
            {upErr && <p className="im-msg" data-ok="false" role="alert">{upErr}</p>}
          </div>
        </div>
      )}

      <ItemNumbers money={money} />
      <Msg state={state} />
      <SubmitButton className="btn btn-primary" pending="Agregando…" disabled={uploading || (source === "catalog" && !pick)}>Agregar producto</SubmitButton>
    </form>
  );
}

export function EditItemForm({ action, item, money }: { action: Action; item: { id: string; qty: number; unit_cost: number; unit_weight_kg: number | null; sale_price_usd: number | null }; money: boolean }) {
  const [state, run] = useActionState(action, null);
  useCloseOnOk(state);
  return (
    <form action={run} className="im-form">
      <input type="hidden" name="item_id" value={item.id} />
      <ItemNumbers money={money} v={item} />
      <Msg state={state} />
      <SubmitButton className="btn btn-primary" pending="Guardando…">Guardar</SubmitButton>
    </form>
  );
}

/** Botón que envía un formulario con un id (quitar un producto, costo, pago o documento). */
/** Enlazar un producto nuevo con el producto de Drop (cuando ya existe allá). */
export function LinkItemForm({ action, itemId, name, choices }: { action: Action; itemId: string; name: string; choices: Choice[] }) {
  const [state, run] = useActionState(action, null);
  const [pick, setPick] = useState<Choice | null>(null);
  useCloseOnOk(state);
  // primero lo que se parece al nombre (sin palabras cortas)
  const initial = name.split(/\s+/).filter((w) => w.length > 3).slice(0, 2).join(" ");
  return (
    <form action={run} className="im-form">
      <input type="hidden" name="item_id" value={itemId} />
      <p className="muted im-small">Al enlazarlo, Inventario lo cuenta como &ldquo;en camino&rdquo; y se ve solo cuando Drop registra su entrada. Si tiene el mismo SKU o nombre, se enlaza solo en la próxima sincronización.</p>
      <CatalogPicker choices={choices} pick={pick} setPick={setPick} initial={initial} empty="Nada con esa búsqueda. Si todavía no está en Drop, se enlazará cuando aparezca." />
      <Msg state={state} />
      <SubmitButton className="btn btn-primary" pending="Enlazando…" disabled={!pick}>Enlazar</SubmitButton>
    </form>
  );
}

export type ReceptionLine = { id: string; name: string; sku: string | null; qty: number; received_qty: number | null; damaged_qty: number; received_note: string | null; drop: number | null };

/** Lo que llegó a la bodega, producto por producto (campos controlados: no se pierden si algo falla). */
export function ReceptionForm({ action, importId, lines }: { action: Action; importId: string; lines: ReceptionLine[] }) {
  const [state, run] = useActionState(action, null);
  const [v, setV] = useState(() =>
    Object.fromEntries(lines.map((l) => [l.id, { recv: l.received_qty === null ? "" : String(l.received_qty), dmg: l.damaged_qty ? String(l.damaged_qty) : "", note: l.received_note ?? "" }])),
  );
  const [warn, setWarn] = useState<string | null>(null);
  useCloseOnOk(state);
  const set = (id: string, k: "recv" | "dmg" | "note", val: string) => setV((cur) => ({ ...cur, [id]: { ...cur[id], [k]: val } }));
  const fillOrdered = () => setV((cur) => Object.fromEntries(lines.map((l) => [l.id, { ...cur[l.id], recv: cur[l.id].recv || String(l.drop ?? l.qty) }])));
  return (
    <form
      action={run}
      className="im-form"
      onSubmit={(e) => {
        const bad = lines.find((l) => v[l.id].dmg && Number(v[l.id].dmg) > Number(v[l.id].recv || 0));
        setWarn(bad ? `${bad.name}: no pueden ser más dañadas que recibidas.` : null);
        if (bad) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={importId} />
      <div className="im-recv-head">
        <p className="muted im-small">Anota lo que contaron en la bodega. Lo que falta o llegó dañado se descuenta: el costo por unidad se calcula con las buenas.</p>
        <button type="button" className="btn btn-sm" onClick={fillOrdered}>Llenar con lo pedido</button>
      </div>
      <ul className="im-recv">
        {lines.map((l) => {
          const r = v[l.id];
          const diff = r.recv === "" ? null : Number(r.recv) - l.qty;
          return (
            <li key={l.id}>
              <div className="im-recv-name">
                <b>{l.name}</b>
                <span>Pedidas {l.qty.toLocaleString("en-US")}{l.drop !== null && <> · Drop registró {l.drop.toLocaleString("en-US")}</>}{diff !== null && diff !== 0 && <em data-bad={diff < 0 || undefined}> · {diff < 0 ? `faltan ${-diff}` : `sobran ${diff}`}</em>}</span>
              </div>
              <label className="field">
                <span>Llegaron</span>
                <input className="input" name={`recv_${l.id}`} type="number" min={0} step={1} inputMode="numeric" value={r.recv} onChange={(e) => set(l.id, "recv", e.target.value)} aria-label={`Llegaron de ${l.name}`} />
              </label>
              <label className="field">
                <span>Dañadas</span>
                <input className="input" name={`dmg_${l.id}`} type="number" min={0} step={1} inputMode="numeric" value={r.dmg} onChange={(e) => set(l.id, "dmg", e.target.value)} aria-label={`Dañadas de ${l.name}`} />
              </label>
              <label className="field im-recv-note">
                <span>Nota <span className="hint">opcional</span></span>
                <input className="input" name={`note_${l.id}`} maxLength={300} value={r.note} onChange={(e) => set(l.id, "note", e.target.value)} placeholder="Caja golpeada, faltó una bolsa…" aria-label={`Nota de ${l.name}`} />
              </label>
            </li>
          );
        })}
      </ul>
      {warn && <p className="im-msg" data-ok="false" role="alert">{warn}</p>}
      <Msg state={state} />
      <SubmitButton className="btn btn-primary" pending="Guardando…">Guardar recepción</SubmitButton>
    </form>
  );
}

export function RemoveButton({ action, name, value, label = "Quitar", confirmText }: { action: Action; name: string; value: string; label?: string; confirmText?: string }) {
  const [state, run] = useActionState(action, null);
  return (
    <form action={run} className="im-inline" onSubmit={(e) => { if (confirmText && !window.confirm(confirmText)) e.preventDefault(); }}>
      <input type="hidden" name={name} value={value} />
      <SubmitButton className="btn btn-ghost btn-sm" pending="…">{label}</SubmitButton>
      {state && !state.ok && <Msg state={state} />}
    </form>
  );
}

// ─── Costos y pagos ───

export function AddCostForm({ action, importId, items }: { action: Action; importId: string; items: { id: string; name: string }[] }) {
  const [state, run] = useActionState(action, null);
  const [kind, setKind] = useState("shipping");
  const [allocation, setAllocation] = useState("weight");
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={run} className="im-form im-cost-form">
      <input type="hidden" name="id" value={importId} />
      <div className="im-grid">
        <label className="field">
          <span>Tipo</span>
          <select className="select" name="kind" value={kind} onChange={(e) => {
            setKind(e.target.value);
            // lo normal: el flete por peso; impuestos y adicionales por valor
            setAllocation(e.target.value === "shipping" ? "weight" : "value");
          }}>
            {COST_KINDS.map((k) => <option key={k.id} value={k.id} title={k.hint}>{k.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Nombre</span>
          <input className="input" name="label" maxLength={120} required placeholder={kind === "shipping" ? "Flete DHL" : kind === "import" ? "Aranceles e impuestos" : "Inspección, etiquetado…"} />
        </label>
        <label className="field">
          <span>Monto <span className="hint">USD</span></span>
          <input className="input" name="amount" inputMode="decimal" required placeholder="0.00" />
        </label>
        <label className="field">
          <span>Repartir</span>
          <select className="select" name="allocation" value={allocation} onChange={(e) => setAllocation(e.target.value)}>
            {ALLOCATIONS.map((a) => <option key={a.id} value={a.id} title={a.hint}>{a.label}</option>)}
          </select>
        </label>
        {allocation === "item" && (
          <label className="field wide">
            <span>Producto</span>
            <select className="select" name="item_id" required defaultValue="">
              <option value="" disabled>Elige el producto</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <Msg state={state} />
      <SubmitButton className="btn" pending="Guardando…">Agregar costo</SubmitButton>
    </form>
  );
}

export function AddPaymentForm({ action, importId }: { action: Action; importId: string }) {
  const [state, run] = useActionState(action, null);
  const [doc, setDoc] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [upErr, setUpErr] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state?.ok) return;
    form.current?.reset();
    setDoc(null);
  }, [state]);

  async function upload(file: File) {
    setUpErr(null);
    const problem = importFileProblem(file.type, file.name, file.size);
    if (problem) return setUpErr(problem);
    setUploading(true);
    try {
      const start = await startImportUpload(importId, "docs", "payment", file.name, file.type, file.size);
      if (!start.ok) return setUpErr(start.msg);
      await put(start.url, file, start.type);
      const reg = await registerImportDocument(importId, start.path, "payment", file.name);
      if (!reg.ok) return setUpErr(reg.msg);
      setDoc({ id: reg.id, name: file.name });
    } catch {
      setUpErr("No se pudo subir el comprobante. Inténtalo de nuevo.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form ref={form} action={run} className="im-form">
      <input type="hidden" name="id" value={importId} />
      <input type="hidden" name="document_id" value={doc?.id ?? ""} />
      <div className="im-grid">
        <label className="field">
          <span>Monto <span className="hint">USD</span></span>
          <input className="input" name="amount" inputMode="decimal" required placeholder="0.00" />
        </label>
        <label className="field">
          <span>Fecha</span>
          <input className="input" type="date" name="paid_at" required defaultValue={new Date().toISOString().slice(0, 10)} />
        </label>
        <label className="field">
          <span>Método</span>
          <select className="select" name="method" required defaultValue="">
            <option value="" disabled>Elige</option>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Nota <span className="hint">opcional</span></span>
          <input className="input" name="note" maxLength={300} placeholder="Anticipo 30 %, saldo…" />
        </label>
        <div className="field wide">
          <span>Comprobante <span className="hint">PDF o foto, opcional</span></span>
          <label className="btn btn-sm im-file">
            <IconUpload /> {uploading ? "Subiendo…" : doc ? doc.name : "Subir comprobante"}
            <input type="file" accept={IMPORT_FILE_ACCEPT} hidden disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
          </label>
          {upErr && <p className="im-msg" data-ok="false" role="alert">{upErr}</p>}
        </div>
      </div>
      <Msg state={state} />
      <SubmitButton className="btn" pending="Guardando…" disabled={uploading}>Registrar pago</SubmitButton>
    </form>
  );
}

// ─── Documentos ───

export function DocUpload({ importId, money, fixedKind, label = "Subir archivos" }: { importId: string; money: boolean; fixedKind?: DocKind; label?: string }) {
  const router = useRouter();
  const kinds = DOC_KINDS.filter((k) => money || !MONEY_DOCS.includes(k.id));
  const [kind, setKind] = useState<string>(fixedKind ?? kinds[0].id);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<ImportFormState>(null);

  async function send(files: File[]) {
    if (!files.length || busy) return;
    setBusy(true);
    setMsg(null);
    let ok = 0;
    for (const f of files.slice(0, 10)) {
      const problem = importFileProblem(f.type, f.name, f.size, fixedKind === "photo");
      if (problem) { setMsg({ ok: false, msg: `${f.name}: ${problem}` }); continue; }
      try {
        const start = await startImportUpload(importId, "docs", kind, f.name, f.type, f.size);
        if (!start.ok) { setMsg({ ok: false, msg: start.msg }); continue; }
        await put(start.url, f, start.type);
        const reg = await registerImportDocument(importId, start.path, kind, f.name);
        if (!reg.ok) { setMsg({ ok: false, msg: reg.msg }); continue; }
        ok++;
      } catch {
        setMsg({ ok: false, msg: `${f.name}: no se pudo subir. Inténtalo de nuevo.` });
      }
    }
    setBusy(false);
    if (ok) {
      setMsg({ ok: true, msg: ok === 1 ? "Documento subido." : `${ok} documentos subidos.` });
      router.refresh();
    }
  }

  return (
    <div className="im-docup">
      {!fixedKind && (
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo de documento">
          {kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      )}
      <label className="btn">
        <IconUpload /> {busy ? "Subiendo…" : label}
        <input type="file" accept={fixedKind === "photo" ? "image/jpeg,image/png,image/webp" : IMPORT_FILE_ACCEPT} multiple hidden disabled={busy} onChange={(e) => { send(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      </label>
      <span className="hint">{fixedKind === "photo" ? "JPG, PNG o WEBP, hasta 25 MB" : "PDF, fotos o Excel, hasta 25 MB"}</span>
      <Msg state={msg} />
    </div>
  );
}

export function DeleteImportForm({ action, importId }: { action: Action; importId: string }) {
  const [state, run] = useActionState(action, null);
  return (
    <form action={run} className="im-form">
      <input type="hidden" name="id" value={importId} />
      <p className="muted">Se borran la importación, sus productos, costos, pagos, documentos y archivos. No se puede deshacer.</p>
      <label className="field">
        <span>Escribe ELIMINAR para confirmar</span>
        <input className="input" name="confirm" autoComplete="off" required />
      </label>
      <Msg state={state} />
      <SubmitButton className="btn btn-danger" pending="Borrando…">Eliminar importación</SubmitButton>
    </form>
  );
}
