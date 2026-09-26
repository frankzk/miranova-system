"use client";

import { useActionState, useId } from "react";
import { SubmitButton } from "./submit-button";
import { FOLLOWUP_STATUS, type FollowupStatus } from "@/lib/store-metrics";

export type FollowupState = { ok: boolean; msg: string } | null;
type Action = (prev: FollowupState, form: FormData) => Promise<FollowupState>;

const STATUS_KEYS = Object.keys(FOLLOWUP_STATUS) as FollowupStatus[];

function Msg({ state }: { state: FollowupState }) {
  if (!state) return null;
  return <p className="fu-msg" data-ok={state.ok} role={state.ok ? "status" : "alert"}>{state.msg}</p>;
}

/** Nuevo registro de seguimiento (responsable, fecha, recomendación, acción, estado, próximo paso). */
export function FollowupForm({
  action, accountId, storeId, storeName, today, owners,
}: { action: Action; accountId: string; storeId: string; storeName: string; today: string; owners: string[] }) {
  const [state, run] = useActionState(action, null);
  const list = useId();
  return (
    <form action={run} className="fu-form">
      <input type="hidden" name="account_id" value={accountId} />
      <input type="hidden" name="store_id" value={storeId} />
      <input type="hidden" name="store_name" value={storeName} />
      <div className="fu-grid">
        <label className="field">
          <span>Responsable</span>
          <input className="input" name="owner" list={list} maxLength={80} autoComplete="off" placeholder="Quién la atiende" />
          <datalist id={list}>{owners.map((o) => <option key={o} value={o} />)}</datalist>
        </label>
        <label className="field">
          <span>Fecha de contacto</span>
          <input className="input" name="contacted_at" type="date" defaultValue={today} max={today} required />
        </label>
        <label className="field">
          <span>Estado</span>
          <select className="select" name="status" defaultValue="pendiente">
            {STATUS_KEYS.map((k) => <option key={k} value={k}>{FOLLOWUP_STATUS[k].label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Próximo seguimiento</span>
          <input className="input" name="next_followup" type="date" min={today} />
        </label>
        <label className="field wide">
          <span>Recomendación</span>
          <input className="input" name="recommendation" maxLength={1000} placeholder="Ej. Probar bundle 2+1" />
        </label>
        <label className="field wide">
          <span>Acción realizada</span>
          <input className="input" name="action_taken" maxLength={1000} placeholder="Ej. Llamada con el dueño, envió creativos nuevos" />
        </label>
      </div>
      <div className="fu-actions">
        <Msg state={state} />
        <SubmitButton className="btn btn-primary" pending="Guardando…">Agregar seguimiento</SubmitButton>
      </div>
    </form>
  );
}

/** Cambiar estado y próximo seguimiento de un registro. */
export function FollowupStatusForm({
  action, id, accountId, status, next,
}: { action: Action; id: string; accountId: string; status: FollowupStatus; next: string | null }) {
  const [state, run] = useActionState(action, null);
  return (
    <form action={run} className="fu-update">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="account_id" value={accountId} />
      <label className="field">
        <span>Estado</span>
        <select className="select" name="status" defaultValue={status}>
          {STATUS_KEYS.map((k) => <option key={k} value={k}>{FOLLOWUP_STATUS[k].label}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Próximo seguimiento</span>
        <input className="input" name="next_followup" type="date" defaultValue={next ?? ""} />
      </label>
      <SubmitButton pending="…">Guardar</SubmitButton>
      <Msg state={state} />
    </form>
  );
}
