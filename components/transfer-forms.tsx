"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";
import { registerTransferDocument, startTransferUpload } from "@/app/(app)/imports/transfers/actions";
import { IMPORT_FILE_ACCEPT, importFileProblem } from "@/lib/imports";
import { LAB_DESTINATIONS } from "@/lib/lab-purchases";
import { accepts, defaultDest, defaultOrigin, GOODS, ITEM_KINDS, type ItemKind, type PendingRow, type TransferPoint } from "@/lib/transfers";
import { IconUpload } from "./icons";
import { CatalogPicker, type Choice } from "./import-forms";
import { useSheet } from "./side-sheet";
import { StickyForm } from "./sticky-form";
import { SubmitButton } from "./submit-button";

type State = { ok: boolean; msg: string } | null;
type Action = (prev: State, form: FormData) => Promise<State>;
type Country = { code: string; name: string };

/** Quien lleva los traslados casi siempre (se puede escribir otro). */
const CARRIERS = ["Boxful", "Moi", "Mensajería propia"];

function Msg({ state }: { state: State }) {
  if (!state) return null;
  return <p className="im-msg" data-ok={state.ok} role={state.ok ? "status" : "alert"}>{state.msg}</p>;
}

function useCloseOnOk(state: State) {
  const sheet = useSheet();
  useEffect(() => {
    if (state?.ok) sheet?.close();
  }, [state, sheet]);
}

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tegucigalpa" }).format(new Date());

/** Sube un archivo al enlace firmado de Storage (mismo formato que los documentos de importaciones). */
async function put(url: string, file: File, type: string): Promise<void> {
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", file.type === type ? file : new File([file], file.name, { type }));
  const res = await fetch(url, { method: "PUT", body, headers: { "x-upsert": "false" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ─── Traslado ───

export type TransferHeader = {
  id?: string; origin_id?: string; dest_country?: string; carrier?: string | null; reference?: string | null; shipped_at?: string | null; eta?: string | null; notes?: string | null;
  status?: string;
};

function HeaderFields({ v, points, countries, locked }: { v: TransferHeader; points: TransferPoint[]; countries: Country[]; locked: boolean }) {
  const origins = points.filter((p) => p.active && p.is_origin);
  const destCountries = countries.filter((c) => points.some((p) => p.active && p.is_destination && p.country === c.code));
  // ya salió: la fecha es obligatoria; si es nuevo o se está preparando, se pone solo si ya salió
  const shipped = v.status === "transit" || v.status === "arrived" || (v.status === "cancelled" && !!v.shipped_at);
  return (
    <div className="im-grid">
      <label className="field">
        <span>Sale de</span>
        <select className="select" name="origin_id" defaultValue={v.origin_id ?? origins[0]?.id ?? ""} required>
          {origins.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Va a</span>
        {locked ? (
          <>
            <input type="hidden" name="dest_country" value={v.dest_country} />
            <input className="input" value={countries.find((c) => c.code === v.dest_country)?.name ?? v.dest_country} disabled />
          </>
        ) : (
          <select className="select" name="dest_country" defaultValue={v.dest_country ?? ""} required>
            <option value="" disabled>Elige el país</option>
            {destCountries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        )}
      </label>
      <label className="field">
        <span>Lo lleva <span className="hint">opcional</span></span>
        <input className="input" name="carrier" list="tr-carriers" defaultValue={v.carrier ?? ""} maxLength={60} placeholder="Boxful, Moi…" />
        <datalist id="tr-carriers">{CARRIERS.map((c) => <option key={c} value={c} />)}</datalist>
      </label>
      <label className="field">
        <span>N.º de manifiesto o guía <span className="hint">opcional</span></span>
        <input className="input" name="reference" defaultValue={v.reference ?? ""} maxLength={80} spellCheck={false} />
      </label>
      {shipped ? (
        <label className="field">
          <span>Salió el</span>
          <input className="input" type="date" name="shipped_at" defaultValue={v.shipped_at ?? ""} max={today()} required={v.status !== "cancelled"} />
        </label>
      ) : v.status !== "cancelled" && (
        <label className="field">
          <span>Fecha de salida <span className="hint">si ya salió</span></span>
          <input className="input" type="date" name="shipped_at" defaultValue="" max={today()} />
        </label>
      )}
      <label className="field">
        <span>Llegada estimada <span className="hint">opcional</span></span>
        <input className="input" type="date" name="eta" defaultValue={v.eta ?? ""} />
      </label>
      <label className="field wide">
        <span>Notas <span className="hint">opcional</span></span>
        <textarea className="input" name="notes" rows={2} defaultValue={v.notes ?? ""} maxLength={2000} />
      </label>
    </div>
  );
}

export function NewTransferForm({ action, points, countries }: { action: Action; points: TransferPoint[]; countries: Country[] }) {
  const [state, run] = useActionState(action, null);
  return (
    <StickyForm state={state} action={run} className="im-form">
      <HeaderFields v={{}} points={points} countries={countries} locked={false} />
      <p className="hint">Con fecha de salida queda “En camino”; sin ella, “Preparando” hasta que lo marques como enviado.</p>
      <Msg state={state} />
      <SubmitButton className="btn btn-primary" pending="Creando…">Crear traslado</SubmitButton>
    </StickyForm>
  );
}

export function TransferHeaderForm({ action, v, points, countries, hasItems }: { action: Action; v: TransferHeader; points: TransferPoint[]; countries: Country[]; hasItems: boolean }) {
  const [state, run] = useActionState(action, null);
  useCloseOnOk(state);
  return (
    <StickyForm state={state} action={run} className="im-form">
      <input type="hidden" name="id" value={v.id} />
      <HeaderFields v={v} points={points} countries={countries} locked={hasItems} />
      <Msg state={state} />
      <SubmitButton className="btn btn-primary" pending="Guardando…">Guardar</SubmitButton>
    </StickyForm>
  );
}

/** Marcar como enviado: fecha de salida (hoy por defecto), estimada de llegada, quién lo lleva y el manifiesto. */
export function ShipForm({ action, id, carrier, reference, eta }: { action: Action; id: string; carrier: string | null; reference: string | null; eta: string | null }) {
  const [state, run] = useActionState(action, null);
  useCloseOnOk(state);
  return (
    <StickyForm state={state} action={run} className="im-form">
      <input type="hidden" name="id" value={id} />
      <div className="im-grid">
        <label className="field">
          <span>Salió el</span>
          <input className="input" type="date" name="shipped_at" defaultValue={today()} max={today()} required />
        </label>
        <label className="field">
          <span>Llegada estimada</span>
          <input className="input" type="date" name="eta" defaultValue={eta ?? ""} />
        </label>
        <label className="field">
          <span>Lo lleva</span>
          <input className="input" name="carrier" list="tr-carriers-ship" defaultValue={carrier ?? ""} maxLength={60} placeholder="Boxful, Moi…" />
          <datalist id="tr-carriers-ship">{CARRIERS.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <label className="field">
          <span>N.º de manifiesto o guía <span className="hint">opcional</span></span>
          <input className="input" name="reference" defaultValue={reference ?? ""} maxLength={80} spellCheck={false} />
        </label>
      </div>
      <Msg state={state} />
      <SubmitButton className="btn btn-primary" pending="Guardando…">Marcar como enviado</SubmitButton>
    </StickyForm>
  );
}

// ─── Productos ───

/** Bodega de destino y clase de producto: la bodega se elige entre las que reciben esa clase. */
function DestKindFields({ dests, kind, setKind, dest, setDest }: { dests: TransferPoint[]; kind: ItemKind; setKind: (k: ItemKind) => void; dest: string; setDest: (d: string) => void }) {
  const fit = dests.filter((d) => accepts(d, kind));
  return (
    <>
      <label className="field">
        <span>Es</span>
        <select className="select" name="kind" value={kind} onChange={(e) => {
          const k = e.target.value as ItemKind;
          setKind(k);
          // si la bodega elegida no recibe esa clase, se pasa a la primera que sí
          if (!dests.some((d) => d.id === dest && accepts(d, k))) setDest(dests.find((d) => accepts(d, k))?.id ?? "");
        }}>
          {ITEM_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Va a la bodega</span>
        <select className="select" name="dest_id" value={dest} onChange={(e) => setDest(e.target.value)} required>
          {!fit.length && <option value="">Ninguna bodega del país recibe esto</option>}
          {fit.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
    </>
  );
}

export function AddLineForm({ action, transferId, dests, choices, foreign, country }: {
  action: Action; transferId: string; dests: TransferPoint[]; choices: Choice[]; foreign: Choice[]; country: string;
}) {
  const [state, run] = useActionState(action, null);
  const [source, setSource] = useState<"catalog" | "text">(choices.length || foreign.length ? "catalog" : "text");
  const [pick, setPick] = useState<Choice | null>(null);
  const [kind, setKind] = useState<ItemKind>("import");
  const [dest, setDest] = useState(() => dests.find((d) => accepts(d, "import"))?.id ?? "");
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!state?.ok) return;
    setPick(null);
    setRound((r) => r + 1); // limpia la búsqueda y la cantidad
  }, [state]);
  return (
    <StickyForm state={state} action={run} className="im-form" key={round}>
      <input type="hidden" name="id" value={transferId} />
      <div className="segmented im-source" role="tablist" aria-label="Qué producto">
        <button type="button" role="tab" aria-selected={source === "catalog"} data-on={source === "catalog" || undefined} onClick={() => setSource("catalog")} disabled={!choices.length && !foreign.length}>Del catálogo</button>
        <button type="button" role="tab" aria-selected={source === "text"} data-on={source === "text" || undefined} onClick={() => { setSource("text"); setPick(null); }}>Escribir el nombre</button>
      </div>
      {source === "catalog" ? (
        <CatalogPicker choices={choices} foreign={foreign} country={country} pick={pick} setPick={setPick} empty="Nada con esa búsqueda. Escribe el nombre." />
      ) : (
        <label className="field">
          <span>Producto</span>
          <input className="input" name="name" maxLength={200} required placeholder="Ej.: Cinturón sin hebilla" />
        </label>
      )}
      <div className="im-grid">
        <DestKindFields dests={dests} kind={kind} setKind={setKind} dest={dest} setDest={setDest} />
        <label className="field">
          <span>Unidades que salen</span>
          <input className="input" name="qty" inputMode="numeric" pattern="[0-9][0-9,]*" required placeholder="250" />
        </label>
      </div>
      <Msg state={state} />
      <SubmitButton className="btn btn-primary" pending="Agregando…" disabled={source === "catalog" && !pick}>Agregar producto</SubmitButton>
    </StickyForm>
  );
}

export function EditLineForm({ action, transferId, item, dests }: { action: Action; transferId: string; item: { id: string; name: string; qty: number; kind: ItemKind; dest_id: string }; dests: TransferPoint[] }) {
  const [state, run] = useActionState(action, null);
  const [kind, setKind] = useState<ItemKind>(item.kind);
  const [dest, setDest] = useState(item.dest_id);
  useCloseOnOk(state);
  return (
    <StickyForm state={state} action={run} className="im-form">
      <input type="hidden" name="id" value={transferId} />
      <input type="hidden" name="item_id" value={item.id} />
      <div className="im-grid">
        <DestKindFields dests={dests} kind={kind} setKind={setKind} dest={dest} setDest={setDest} />
        <label className="field">
          <span>Unidades que salen</span>
          <input className="input" name="qty" inputMode="numeric" pattern="[0-9][0-9,]*" required defaultValue={item.qty} />
        </label>
      </div>
      <Msg state={state} />
      <SubmitButton className="btn btn-primary" pending="Guardando…">Guardar</SubmitButton>
    </StickyForm>
  );
}

// ─── Llegada a una bodega ───

export type ArrivalLine = { id: string; name: string; qty: number; received_qty: number | null; damaged_qty: number; received_note: string | null };

/** Lo que llegó a una bodega, producto por producto (campos controlados: no se pierden si algo falla). */
export function ArrivalForm({ action, transferId, destId, lines, arrivedAt, note, minDate }: {
  action: Action; transferId: string; destId: string; lines: ArrivalLine[]; arrivedAt: string | null; note: string | null; minDate: string | null;
}) {
  const [state, run] = useActionState(action, null);
  const [v, setV] = useState(() =>
    Object.fromEntries(lines.map((l) => [l.id, { recv: l.received_qty === null ? "" : String(l.received_qty), dmg: l.damaged_qty ? String(l.damaged_qty) : "", note: l.received_note ?? "" }])),
  );
  useCloseOnOk(state);
  const set = (id: string, k: "recv" | "dmg" | "note", val: string) => setV((cur) => ({ ...cur, [id]: { ...cur[id], [k]: val } }));
  const fillSent = () => setV((cur) => Object.fromEntries(lines.map((l) => [l.id, { ...cur[l.id], recv: cur[l.id].recv || String(l.qty) }])));
  return (
    <StickyForm state={state} action={run} className="im-form">
      <input type="hidden" name="id" value={transferId} />
      <input type="hidden" name="dest_id" value={destId} />
      <div className="im-grid">
        <label className="field">
          <span>Llegó el</span>
          <input className="input" type="date" name="arrived_at" defaultValue={arrivedAt ?? today()} min={minDate ?? undefined} max={today()} required />
        </label>
      </div>
      <div className="im-recv-head">
        <p className="muted im-small">Lo que contaron al recibir, cotejado con la bodega. Si falta algo, la diferencia queda como merma.</p>
        <button type="button" className="btn btn-sm" onClick={fillSent}>Llenar con lo enviado</button>
      </div>
      <ul className="im-recv">
        {lines.map((l) => {
          const r = v[l.id];
          const diff = r.recv === "" ? null : Number(r.recv.replace(/[,\s]/g, "")) - l.qty;
          return (
            <li key={l.id}>
              <div className="im-recv-name">
                <b>{l.name}</b>
                <span>Salieron {l.qty.toLocaleString("en-US")}{diff !== null && !Number.isNaN(diff) && diff !== 0 && <em data-bad={diff < 0 || undefined}> · {diff < 0 ? `merma ${-diff}` : `sobran ${diff}`}</em>}</span>
              </div>
              <label className="field">
                <span>Llegaron</span>
                <input className="input" name={`recv_${l.id}`} inputMode="numeric" pattern="[0-9][0-9,]*" required value={r.recv} onChange={(e) => set(l.id, "recv", e.target.value)} aria-label={`Llegaron de ${l.name}`} />
              </label>
              <label className="field">
                <span>Dañadas</span>
                <input className="input" name={`dmg_${l.id}`} inputMode="numeric" pattern="[0-9][0-9,]*" value={r.dmg} onChange={(e) => set(l.id, "dmg", e.target.value)} placeholder="0" aria-label={`Dañadas de ${l.name}`} />
              </label>
              <label className="field im-recv-note">
                <span>Nota <span className="hint">opcional</span></span>
                <input className="input" name={`note_${l.id}`} maxLength={300} value={r.note} onChange={(e) => set(l.id, "note", e.target.value)} placeholder="Caja golpeada, faltó un bulto…" aria-label={`Nota de ${l.name}`} />
              </label>
            </li>
          );
        })}
      </ul>
      <label className="field">
        <span>Nota de la llegada <span className="hint">opcional</span></span>
        <input className="input" name="note" maxLength={500} defaultValue={note ?? ""} placeholder="Cotejado con Dannis, llegó en la tarde…" />
      </label>
      <Msg state={state} />
      <SubmitButton className="btn btn-primary" pending="Guardando…">Guardar llegada</SubmitButton>
    </StickyForm>
  );
}

// ─── Documentos ───

const DOC_KINDS = [
  { id: "manifest", label: "Manifiesto" },
  { id: "photo", label: "Foto de la llegada" },
  { id: "other", label: "Otro documento" },
];

export function TransferDocUpload({ transferId }: { transferId: string }) {
  const router = useRouter();
  const [kind, setKind] = useState("manifest");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<State>(null);
  async function send(files: File[]) {
    if (!files.length || busy) return;
    setBusy(true);
    setMsg(null);
    let ok = 0;
    for (const f of files.slice(0, 10)) {
      const problem = importFileProblem(f.type, f.name, f.size, kind === "photo");
      if (problem) { setMsg({ ok: false, msg: `${f.name}: ${problem}` }); continue; }
      try {
        const start = await startTransferUpload(transferId, kind, f.name, f.type, f.size);
        if (!start.ok) { setMsg({ ok: false, msg: start.msg }); continue; }
        await put(start.url, f, start.type);
        const reg = await registerTransferDocument(transferId, start.path, kind, f.name);
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
      <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo de documento">
        {DOC_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
      </select>
      <label className="btn">
        <IconUpload /> {busy ? "Subiendo…" : "Subir archivos"}
        <input type="file" accept={kind === "photo" ? "image/jpeg,image/png,image/webp" : IMPORT_FILE_ACCEPT} multiple hidden disabled={busy} onChange={(e) => { send(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      </label>
      <span className="hint">{kind === "photo" ? "JPG, PNG o WEBP, hasta 25 MB" : "PDF, fotos o Excel, hasta 25 MB"}</span>
      <Msg state={msg} />
    </div>
  );
}

export function DeleteTransferForm({ action, transferId }: { action: Action; transferId: string }) {
  const [state, run] = useActionState(action, null);
  return (
    <StickyForm state={state} action={run} className="im-form">
      <input type="hidden" name="id" value={transferId} />
      <p className="muted">Se borran el traslado, sus productos, documentos y archivos. No se puede deshacer.</p>
      <label className="field">
        <span>Escribe ELIMINAR para confirmar</span>
        <input className="input" name="confirm" autoComplete="off" required />
      </label>
      <Msg state={state} />
      <SubmitButton className="btn btn-danger" pending="Borrando…">Borrar traslado</SubmitButton>
    </StickyForm>
  );
}

// ─── Por enviar ───

/**
 * Armar un traslado con lo que falta mandar a un país: se marcan los productos (todos de entrada), cuántas
 * unidades salen (lo que falta, por defecto) y a qué bodega va cada uno.
 */
export function BuildTransferForm({ action, country, countryName, rows, points }: { action: Action; country: string; countryName: string; rows: PendingRow[]; points: TransferPoint[] }) {
  const [state, run] = useActionState(action, null);
  const dests = useMemo(() => points.filter((p) => p.active && p.is_destination && p.country === country).sort((a, b) => a.position - b.position), [points, country]);
  const origins = points.filter((p) => p.active && p.is_origin);
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((r) => [r.source, true])));
  const [kinds, setKinds] = useState<Record<string, ItemKind>>(() => Object.fromEntries(rows.map((r) => [r.source, r.kind])));
  const [destOf, setDestOf] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.source, r.dest_id ?? defaultDest(points, country, r.kind)?.id ?? ""])),
  );
  // origen propuesto: si todo lo marcado es maquilado (y no va a El Salvador), Moi; si no, Boxful Guatemala
  const chosen = rows.filter((r) => on[r.source]);
  const allMaquila = chosen.length > 0 && chosen.every((r) => kinds[r.source] === "maquila");
  const suggested = defaultOrigin(points, allMaquila ? "maquila" : "import", country)?.id ?? origins[0]?.id ?? "";
  const [origin, setOrigin] = useState<string | null>(null);
  useCloseOnOk(state);
  return (
    <StickyForm state={state} action={run} className="im-form">
      <input type="hidden" name="dest_country" value={country} />
      <div className="im-grid">
        <label className="field">
          <span>Sale de</span>
          <select className="select" name="origin_id" value={origin ?? suggested} onChange={(e) => setOrigin(e.target.value)}>
            {origins.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Lo lleva <span className="hint">opcional</span></span>
          <input className="input" name="carrier" list="tr-carriers-build" maxLength={60} placeholder="Boxful, Moi…" />
          <datalist id="tr-carriers-build">{CARRIERS.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
      </div>
      <ul className="tr-build">
        {rows.map((r) => {
          const fixed = r.dest_id !== null;
          const fit = dests.filter((d) => accepts(d, kinds[r.source]));
          return (
            <li key={r.source} data-off={!on[r.source] || undefined}>
              <label className="tr-build-check">
                <input type="checkbox" name="source" value={r.source} checked={on[r.source]} onChange={(e) => setOn((cur) => ({ ...cur, [r.source]: e.target.checked }))} />
                <span><b>{r.product}</b><span>{r.from} · faltan {r.pending.toLocaleString("en-US")}</span></span>
              </label>
              <div className="tr-build-fields">
                <label className="field">
                  <span>Unidades</span>
                  <input className="input" name={`qty_${r.source}`} inputMode="numeric" pattern="[0-9][0-9,]*" defaultValue={r.pending} disabled={!on[r.source]} aria-label={`Unidades de ${r.product}`} />
                </label>
                <label className="field">
                  <span>Es</span>
                  <select className="select" name={`kind_${r.source}`} value={kinds[r.source]} disabled={!on[r.source]} onChange={(e) => {
                    const k = e.target.value as ItemKind;
                    setKinds((cur) => ({ ...cur, [r.source]: k }));
                    if (!fixed && !dests.some((d) => d.id === destOf[r.source] && accepts(d, k))) setDestOf((cur) => ({ ...cur, [r.source]: dests.find((d) => accepts(d, k))?.id ?? "" }));
                  }}>
                    {ITEM_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Bodega</span>
                  <select className="select" name={`dest_${r.source}`} value={destOf[r.source]} disabled={!on[r.source]} onChange={(e) => setDestOf((cur) => ({ ...cur, [r.source]: e.target.value }))}>
                    {(fixed ? dests.filter((d) => d.id === r.dest_id) : fit).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </label>
              </div>
            </li>
          );
        })}
      </ul>
      <Msg state={state} />
      <SubmitButton className="btn btn-primary" pending="Armando…" disabled={!chosen.length}>
        Armar traslado a {countryName} ({chosen.length} {chosen.length === 1 ? "producto" : "productos"})
      </SubmitButton>
      <p className="muted im-small">Queda &ldquo;Preparando&rdquo;: después puedes agregar o quitar productos, subir el manifiesto y marcarlo como enviado.</p>
    </StickyForm>
  );
}

/** Dar por enviado un reparto sin traslado (se mandó por fuera o ya no se manda). */
export function SettleForm({ action, source, product }: { action: Action; source: string; product: string }) {
  const [state, run] = useActionState(action, null);
  return (
    <StickyForm state={state} action={run} className="im-inline" onSubmit={(e) => { if (!window.confirm(`¿Quitar “${product}” de por enviar? Úsalo si ya se mandó por fuera o ya no se manda.`)) e.preventDefault(); }}>
      <input type="hidden" name="source" value={source} />
      <SubmitButton className="btn btn-ghost btn-sm" pending="…">Quitar</SubmitButton>
      {state && !state.ok && <Msg state={state} />}
    </StickyForm>
  );
}

// ─── Bodegas ───

export function PointForm({ action, point, countries }: { action: Action; point?: TransferPoint; countries: Country[] }) {
  const [state, run] = useActionState(action, null);
  useCloseOnOk(state);
  return (
    <StickyForm state={state} action={run} className="im-form">
      {point && <input type="hidden" name="id" value={point.id} />}
      <div className="im-grid">
        <label className="field">
          <span>Nombre</span>
          <input className="input" name="name" defaultValue={point?.name ?? ""} maxLength={80} required placeholder="Bodega de Alex" />
        </label>
        <label className="field">
          <span>País</span>
          <select className="select" name="country" defaultValue={point?.country ?? ""} required>
            <option value="" disabled>Elige el país</option>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Ciudad <span className="hint">opcional</span></span>
          <input className="input" name="city" defaultValue={point?.city ?? ""} maxLength={60} />
        </label>
        <label className="field">
          <span>Como destino recibe</span>
          <select className="select" name="goods" defaultValue={point?.goods ?? "both"}>
            {GOODS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </label>
        <fieldset className="field wide tr-checks">
          <legend>Es</legend>
          <label><input type="checkbox" name="is_origin" value="1" defaultChecked={point?.is_origin ?? false} /> Origen (de aquí salen traslados)</label>
          <label><input type="checkbox" name="is_destination" value="1" defaultChecked={point?.is_destination ?? true} /> Destino (aquí llegan)</label>
          {point && <label><input type="checkbox" name="active" value="0" defaultChecked={!point.active} /> Ya no se usa (ocultarla)</label>}
        </fieldset>
        <fieldset className="field wide tr-checks">
          <legend>Abastece a <span className="hint">para los repartos de Laboratorios</span></legend>
          <div className="tr-accounts">
            {LAB_DESTINATIONS.map((d) => <label key={d.id}><input type="checkbox" name="accounts" value={d.id} defaultChecked={point?.accounts.includes(d.id)} /> {d.label}</label>)}
          </div>
        </fieldset>
      </div>
      <Msg state={state} />
      <SubmitButton className="btn btn-primary" pending="Guardando…">{point ? "Guardar" : "Agregar bodega"}</SubmitButton>
    </StickyForm>
  );
}
