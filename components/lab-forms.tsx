"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { LAB_DESTINATIONS, LAB_STATUSES, labTotals, type Distribution, type LabStatus } from "@/lib/lab-purchases";
import { useSheet } from "./side-sheet";
import { StickyForm } from "./sticky-form";
import { SubmitButton } from "./submit-button";

type State = { ok: boolean; msg: string } | null;
type Action = (prev: State, form: FormData) => Promise<State>;

export type LabValues = {
  id?: string; product?: string; lab_name?: string | null; status?: LabStatus; requested_at?: string; shipped_at?: string | null;
  arrived_at?: string | null; boxes?: number | null; qty_requested?: number; qty_courtesy?: number; distribution?: Distribution;
  unit_price_gtq?: number | null; fx_gtq_per_usd?: number | null; notes?: string | null;
};

function Msg({ state }: { state: State }) {
  if (!state) return null;
  return <p className="im-msg" data-ok={state.ok} role={state.ok ? "status" : "alert"}>{state.msg}</p>;
}

const int = (s: string) => {
  const n = Number(s.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const dec = (s: string) => {
  const n = Number(s.replace(/[,\sQq]/g, ""));
  return s.trim() && Number.isFinite(n) ? n : null;
};
const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Compra a laboratorio: producto, estado, fechas, cajas, cantidades, reparto por cuenta y (con
 * permiso de Dinero) precio en quetzales y tipo de cambio. Los totales se calculan al escribir.
 */
export function LabForm({
  action, v = {}, today, money, defaultFx, labs, products,
}: {
  action: Action;
  v?: LabValues;
  today: string;
  money: boolean;
  /** Quetzales por dólar sugeridos para una compra nueva. */
  defaultFx: number;
  labs: string[];
  products: string[];
}) {
  const [state, run] = useActionState(action, null);
  const sheet = useSheet();
  const uid = useId();
  const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
  const [qty, setQty] = useState(str(v.qty_requested));
  const [courtesy, setCourtesy] = useState(str(v.qty_courtesy ?? 0));
  const [dist, setDist] = useState<Record<string, string>>(Object.fromEntries(LAB_DESTINATIONS.map((d) => [d.id, str(v.distribution?.[d.id])])));
  const [price, setPrice] = useState(str(v.unit_price_gtq));
  const [fx, setFx] = useState(str(v.fx_gtq_per_usd ?? (v.id ? null : defaultFx)));

  useEffect(() => {
    if (state?.ok) sheet?.close();
  }, [state, sheet]);

  const t = labTotals({
    qty_requested: int(qty),
    qty_courtesy: int(courtesy),
    distribution: Object.fromEntries(Object.entries(dist).map(([k, s]) => [k, int(s)])),
    unit_price_gtq: dec(price),
    fx_gtq_per_usd: dec(fx),
  });

  return (
    <StickyForm state={state} action={run} className="im-form lab-form">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <div className="im-grid">
        <label className="field wide">
          <span>Producto</span>
          <input className="input" name="product" defaultValue={v.product ?? ""} maxLength={160} required list={`${uid}-products`} autoComplete="off" placeholder="Ej.: Drenaje linfático Maya Verra" />
        </label>
        <label className="field">
          <span>Laboratorio <span className="hint">opcional</span></span>
          <input className="input" name="lab_name" defaultValue={v.lab_name ?? ""} maxLength={120} list={`${uid}-labs`} autoComplete="off" placeholder="Nombre del laboratorio" />
        </label>
        <label className="field">
          <span>Estado</span>
          <select className="select" name="status" defaultValue={v.status ?? "requested"}>
            {LAB_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Fecha de solicitud</span>
          <input className="input" type="date" name="requested_at" defaultValue={v.requested_at ?? today} max={today} required />
        </label>
        <label className="field">
          <span>Fecha de traslado <span className="hint">opcional</span></span>
          <input className="input" type="date" name="shipped_at" defaultValue={v.shipped_at ?? ""} />
        </label>
        <label className="field">
          <span>Llegada a Drop <span className="hint">opcional</span></span>
          <input className="input" type="date" name="arrived_at" defaultValue={v.arrived_at ?? ""} />
        </label>
        <label className="field">
          <span>Nro. de cajas <span className="hint">opcional</span></span>
          <input className="input" name="boxes" defaultValue={str(v.boxes)} inputMode="numeric" pattern="[0-9][0-9,]*" placeholder="20" />
        </label>
        <label className="field">
          <span>Cantidad solicitada</span>
          <input className="input" name="qty_requested" value={qty} onChange={(e) => setQty(e.currentTarget.value)} inputMode="numeric" pattern="[0-9][0-9,]*" required placeholder="1000" />
        </label>
        <label className="field">
          <span>Cortesía <span className="hint">unidades sin costo</span></span>
          <input className="input" name="qty_courtesy" value={courtesy} onChange={(e) => setCourtesy(e.currentTarget.value)} inputMode="numeric" pattern="[0-9][0-9,]*" placeholder="0" />
        </label>
        <p className="lab-total wide">Solicitada + cortesía: <b>{fmt(t.total)}</b> unidades</p>

        <fieldset className="field wide lab-dist">
          <legend>Reparto por cuenta <span className="hint">unidades</span></legend>
          <div className="lab-dist-grid">
            {LAB_DESTINATIONS.map((d) => (
              <label key={d.id} className="field">
                <span>{d.label}</span>
                <input
                  className="input" name={`d_${d.id}`} value={dist[d.id]} inputMode="numeric" pattern="[0-9][0-9,]*" placeholder="0"
                  onChange={(e) => {
                    const val = e.currentTarget.value;
                    setDist((p) => ({ ...p, [d.id]: val }));
                  }}
                />
              </label>
            ))}
          </div>
          <p className="lab-dist-sum" data-state={t.pending < 0 ? "over" : t.pending === 0 ? "ok" : "left"}>
            Total distribuidas: <b>{fmt(t.distributed)}</b>
            {t.total > 0 && (t.pending > 0 ? ` · faltan ${fmt(t.pending)} por repartir` : t.pending < 0 ? ` · ${fmt(-t.pending)} de más` : " · todo repartido")}
          </p>
        </fieldset>

        {money && (
          <>
            <label className="field">
              <span>Precio unit. <span className="hint">quetzales</span></span>
              <input className="input" name="unit_price_gtq" value={price} onChange={(e) => setPrice(e.currentTarget.value)} inputMode="decimal" placeholder="12.50" />
            </label>
            <label className="field">
              <span>Tipo de cambio <span className="hint">Q por USD</span></span>
              <input className="input" name="fx_gtq_per_usd" value={fx} onChange={(e) => setFx(e.currentTarget.value)} inputMode="decimal" placeholder="7.65" />
            </label>
            <p className="lab-total wide">
              Monto total: <b>{t.amount_gtq === null ? "—" : `Q${fmt(t.amount_gtq, 2)}`}</b>
              {t.amount_usd !== null && <> · <b>${fmt(t.amount_usd, 2)}</b></>}
              <span className="hint"> (precio × cantidad solicitada; la cortesía no se cobra)</span>
            </p>
          </>
        )}

        <label className="field wide">
          <span>Notas <span className="hint">opcional</span></span>
          <textarea className="input" name="notes" rows={2} defaultValue={v.notes ?? ""} maxLength={2000} />
        </label>
      </div>
      <datalist id={`${uid}-labs`}>{labs.map((l) => <option key={l} value={l} />)}</datalist>
      <datalist id={`${uid}-products`}>{products.map((p) => <option key={p} value={p} />)}</datalist>
      <Msg state={state} />
      <SubmitButton className="btn btn-primary" pending="Guardando…">{v.id ? "Guardar" : "Guardar compra"}</SubmitButton>
    </StickyForm>
  );
}

/** Estado desde la lista: se guarda al elegirlo. */
export function LabStatusSelect({ action, id, status }: { action: Action; id: string; status: LabStatus }) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="rq-status lab-status">
      <input type="hidden" name="id" value={id} />
      <select
        className="select" name="status" defaultValue={status} disabled={pending} aria-label="Estado de la compra"
        data-status={status} onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {LAB_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      {state && !state.ok && <p className="im-msg" data-ok="false" role="alert">{state.msg}</p>}
    </form>
  );
}

export function DeleteLabForm({ action, id, label }: { action: Action; id: string; label: string }) {
  const [state, run] = useActionState(action, null);
  const sheet = useSheet();
  useEffect(() => {
    if (state?.ok) sheet?.close();
  }, [state, sheet]);
  return (
    <StickyForm state={state} action={run} className="im-inline" onSubmit={(e) => { if (!window.confirm(`¿Borrar la compra de ${label}?`)) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton className="btn btn-ghost btn-sm btn-danger" pending="Borrando…">Borrar compra</SubmitButton>
      <Msg state={state} />
    </StickyForm>
  );
}
