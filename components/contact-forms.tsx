"use client";

import { useActionState } from "react";
import { SubmitButton } from "./submit-button";

export type ContactState = { ok: boolean; msg: string } | null;
type Action = (prev: ContactState, form: FormData) => Promise<ContactState>;
type StoreRef = { accountId: string; storeId: string; storeName: string };

function Msg({ state }: { state: ContactState }) {
  if (!state) return null;
  return <p className="fu-msg" data-ok={state.ok} role={state.ok ? "status" : "alert"}>{state.msg}</p>;
}

function StoreFields({ s }: { s: StoreRef }) {
  return (
    <>
      <input type="hidden" name="account_id" value={s.accountId} />
      <input type="hidden" name="store_id" value={s.storeId} />
      <input type="hidden" name="store_name" value={s.storeName} />
    </>
  );
}

/** Alta o edición del contacto: grupo de WhatsApp, teléfono, responsable y notas. */
export function ContactForm({
  action, store, defaults, submit,
}: {
  action: Action;
  store: StoreRef;
  defaults: { group?: string | null; phone?: string | null; owner_name?: string | null; notes?: string | null };
  submit: string;
}) {
  const [state, run] = useActionState(action, null);
  return (
    <form action={run} className="ct-form">
      <StoreFields s={store} />
      <label className="field">
        <span>Grupo de WhatsApp <span className="hint">enlace de invitación</span></span>
        <input className="input" name="group" type="text" inputMode="url" spellCheck={false} defaultValue={defaults.group ?? ""} placeholder="https://chat.whatsapp.com/…" autoComplete="off" />
      </label>
      <div className="ct-row">
        <label className="field">
          <span>Teléfono del dueño</span>
          <input className="input" name="phone" type="tel" inputMode="tel" defaultValue={defaults.phone ? `+${defaults.phone}` : ""} placeholder="+504 9999 8888" autoComplete="off" />
        </label>
        <label className="field">
          <span>Responsable</span>
          <input className="input" name="owner_name" maxLength={120} defaultValue={defaults.owner_name ?? ""} autoComplete="off" />
        </label>
      </div>
      <label className="field">
        <span>Notas</span>
        <input className="input" name="notes" maxLength={1000} defaultValue={defaults.notes ?? ""} placeholder="Ej. atiende de 8 a 5, prefiere audios" />
      </label>
      <div className="fu-actions">
        <Msg state={state} />
        <SubmitButton className="btn btn-primary" pending="Guardando…">{submit}</SubmitButton>
      </div>
    </form>
  );
}

/** Botón de una sola acción sobre una tienda (vincular o desvincular). */
export function StoreActionButton({
  action, contactId, store, label, pending, className = "btn btn-sm",
}: { action: Action; contactId: string; store: StoreRef; label: string; pending: string; className?: string }) {
  const [state, run] = useActionState(action, null);
  return (
    <form action={run} className="ct-inline">
      <input type="hidden" name="contact_id" value={contactId} />
      <StoreFields s={store} />
      <SubmitButton className={className} pending={pending}>{label}</SubmitButton>
      {state && !state.ok && <Msg state={state} />}
    </form>
  );
}
