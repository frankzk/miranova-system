"use client";

import { useActionState, useEffect } from "react";
import type { ImportFormState } from "./import-forms";
import { useSheet } from "./side-sheet";
import { StickyForm } from "./sticky-form";
import { SubmitButton } from "./submit-button";

type Action = (prev: ImportFormState, form: FormData) => Promise<ImportFormState>;
export type SupplierValues = {
  id?: string; name?: string; origin?: string | null; contact?: string | null; whatsapp?: string | null; email?: string | null;
  payment_terms?: string | null; notes?: string | null;
};

function Msg({ state }: { state: ImportFormState }) {
  if (!state) return null;
  return <p className="im-msg" data-ok={state.ok} role={state.ok ? "status" : "alert"}>{state.msg}</p>;
}

/** Crear o editar un proveedor: contacto, WhatsApp, condiciones de pago y notas. */
export function SupplierForm({ action, v = {} }: { action: Action; v?: SupplierValues }) {
  const [state, run] = useActionState(action, null);
  const sheet = useSheet();
  useEffect(() => {
    if (state?.ok) sheet?.close();
  }, [state, sheet]);
  return (
    <StickyForm state={state} action={run} className="im-form">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <div className="im-grid">
        <label className="field">
          <span>Nombre</span>
          <input className="input" name="name" defaultValue={v.name ?? ""} maxLength={120} required />
        </label>
        <label className="field">
          <span>Origen <span className="hint">país o ciudad</span></span>
          <input className="input" name="origin" defaultValue={v.origin ?? ""} maxLength={80} placeholder="China, Yiwu…" />
        </label>
        <label className="field">
          <span>Contacto <span className="hint">opcional</span></span>
          <input className="input" name="contact" defaultValue={v.contact ?? ""} maxLength={120} placeholder="Nombre de la persona" />
        </label>
        <label className="field">
          <span>WhatsApp <span className="hint">con código de país</span></span>
          <input className="input" name="whatsapp" defaultValue={v.whatsapp ?? ""} maxLength={40} inputMode="tel" placeholder="+86 138 0000 0000" />
        </label>
        <label className="field wide">
          <span>Correo <span className="hint">opcional</span></span>
          <input className="input" name="email" type="email" defaultValue={v.email ?? ""} maxLength={160} />
        </label>
        <label className="field wide">
          <span>Condiciones de pago <span className="hint">opcional</span></span>
          <input className="input" name="payment_terms" defaultValue={v.payment_terms ?? ""} maxLength={300} placeholder="30 % de anticipo, 70 % antes de enviar" />
        </label>
        <label className="field wide">
          <span>Notas</span>
          <textarea className="input" name="notes" rows={3} defaultValue={v.notes ?? ""} maxLength={2000} placeholder="Mínimo de compra, calidad, tiempos…" />
        </label>
      </div>
      <Msg state={state} />
      <SubmitButton className="btn btn-primary" pending="Guardando…">{v.id ? "Guardar" : "Crear proveedor"}</SubmitButton>
    </StickyForm>
  );
}

export function DeleteSupplierForm({ action, id, name }: { action: Action; id: string; name: string }) {
  const [state, run] = useActionState(action, null);
  return (
    <StickyForm state={state} action={run} className="im-inline" onSubmit={(e) => { if (!window.confirm(`¿Borrar el proveedor ${name}?`)) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton className="btn btn-ghost btn-sm btn-danger" pending="Borrando…">Borrar proveedor</SubmitButton>
      <Msg state={state} />
    </StickyForm>
  );
}
