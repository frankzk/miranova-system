"use client";

import { useActionState, useEffect, useState } from "react";
import { SubmitButton } from "./submit-button";

export type EmailFormState = { ok: boolean; msg: string } | null;
type Action = (prev: EmailFormState, form: FormData) => Promise<EmailFormState>;

function Msg({ state }: { state: EmailFormState }) {
  if (!state) return null;
  return <p className="fu-msg" data-ok={state.ok} role={state.ok ? "status" : "alert"}>{state.msg}</p>;
}

/** Cuenta de Gmail que envía y a quién le llega el resumen diario. La contraseña nunca vuelve al navegador. */
export function EmailSettingsForm({
  action, gmailUser, hasPassword, digestTo,
}: { action: Action; gmailUser: string; hasPassword: boolean; digestTo: string[] }) {
  const [state, run] = useActionState(action, null);
  // campos controlados: React vacía el formulario tras cada envío y, si algo no pasa la
  // validación, no hay que volver a escribirlo todo
  const [user, setUser] = useState(gmailUser);
  const [pass, setPass] = useState("");
  const [to, setTo] = useState(digestTo.join(", "));
  useEffect(() => {
    if (state?.ok) setPass("");
  }, [state]);
  return (
    <form action={run} className="em-form">
      <div className="ct-row">
        <label className="field">
          <span>Cuenta de Gmail que envía</span>
          <input className="input" name="gmail_user" type="email" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" spellCheck={false} placeholder="ej. miranova.avisos@gmail.com" />
        </label>
        <label className="field">
          <span>Contraseña de aplicación <span className="hint">16 letras</span></span>
          <input
            className="input" name="gmail_app_password" type="password" autoComplete="new-password" spellCheck={false}
            value={pass} onChange={(e) => setPass(e.target.value)}
            placeholder={hasPassword ? "Guardada · escribe otra para cambiarla" : "abcd efgh ijkl mnop"}
          />
        </label>
      </div>
      <label className="field">
        <span>Reciben el resumen diario de inventario <span className="hint">separa varios con coma</span></span>
        <input className="input" name="digest_to" value={to} onChange={(e) => setTo(e.target.value)} autoComplete="off" spellCheck={false} placeholder="ej. gaby@aurela.pe, ops@miranova.com" />
      </label>
      <div className="fu-actions">
        <Msg state={state} />
        <SubmitButton className="btn btn-primary" pending="Guardando…">Guardar</SubmitButton>
      </div>
    </form>
  );
}

/** Envía un correo de prueba a quienes reciben el resumen. */
export function TestEmailForm({ action }: { action: Action }) {
  const [state, run] = useActionState(action, null);
  return (
    <form action={run} className="em-test">
      <SubmitButton className="btn" pending="Enviando…">Enviar correo de prueba</SubmitButton>
      <Msg state={state} />
    </form>
  );
}
