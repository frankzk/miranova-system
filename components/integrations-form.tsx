"use client";

import { useActionState } from "react";
import type { ImportFormState } from "./import-forms";
import { StickyForm } from "./sticky-form";
import { SubmitButton } from "./submit-button";

type Action = (prev: ImportFormState, form: FormData) => Promise<ImportFormState>;
type Status = { source: "panel" | "vercel" | null; tail: string | null };

function KeyField({ name, label, status, placeholder, help }: { name: string; label: string; status: Status; placeholder: string; help: React.ReactNode }) {
  return (
    <div className="field int-field">
      <span>{label}</span>
      <p className="int-state" data-on={status.source ? true : undefined}>
        <span className="dot" data-tone={status.source ? "success" : "neutral"} aria-hidden />
        {status.source === "panel" && <>Guardada aquí · termina en <b>{status.tail}</b></>}
        {status.source === "vercel" && <>Configurada en Vercel · termina en <b>{status.tail}</b></>}
        {!status.source && <>Sin clave</>}
      </p>
      <input className="input" name={`${name}_key`} type="password" autoComplete="off" spellCheck={false} placeholder={status.source ? "Escribe una nueva para cambiarla" : placeholder} aria-label={label} />
      {status.source === "panel" && (
        <label className="int-clear"><input type="checkbox" name={`${name}_clear`} value="1" /> Borrar la clave guardada</label>
      )}
      <div className="hint">{help}</div>
    </div>
  );
}

export function IntegrationsForm({ action, dhl, track17, anthropic }: { action: Action; dhl: Status; track17: Status; anthropic: Status }) {
  const [state, run] = useActionState(action, null);
  return (
    <StickyForm state={state} action={run} className="im-form int-form">
      <KeyField
        name="dhl"
        label="DHL · seguimiento de guías DHL (gratis)"
        status={dhl}
        placeholder="API Key de DHL"
        help={
          <>
            En <b>developer.dhl.com</b> crea una cuenta gratis → <b>My Apps</b> → <b>Create App</b>, elige la API <b>Shipment Tracking - Unified</b> y,
            cuando la aprueben, copia la <b>API Key</b> de la app. Gratis hasta 250 consultas al día; el panel revisa cada guía DHL cada 3 horas.
          </>
        }
      />
      <KeyField
        name="track17"
        label="17TRACK · seguimiento de guías de otras paqueteras"
        status={track17}
        placeholder="Access Key de 17TRACK"
        help={<>Crea una cuenta en 17track.net (API), copia la <b>Access Key</b> de Settings → Security. El plan gratuito trae una cantidad limitada de guías al mes; cada guía nueva usa una.</>}
      />
      <KeyField
        name="anthropic"
        label="Anthropic · leer facturas con IA"
        status={anthropic}
        placeholder="sk-ant-…"
        help={<>En console.anthropic.com → API Keys crea una clave y pégala aquí. Cada factura leída cuesta unos centavos de dólar.</>}
      />
      {state && <p className="im-msg" data-ok={state.ok} role={state.ok ? "status" : "alert"}>{state.msg}</p>}
      <SubmitButton className="btn btn-primary" pending="Guardando…">Guardar</SubmitButton>
    </StickyForm>
  );
}

/** Probar la clave de DHL con una guía real: muestra lo que responde DHL, sin guardar nada. */
export function DhlTestForm({ action }: { action: Action }) {
  const [state, run] = useActionState(action, null);
  return (
    <form action={run} className="int-test">
      <label className="field">
        <span>Probar la clave de DHL con una guía</span>
        <div className="int-test-row">
          <input className="input" name="number" required inputMode="text" autoComplete="off" spellCheck={false} placeholder="Número de guía DHL (ej.: 1647792425)" maxLength={40} />
          <SubmitButton className="btn" pending="Consultando…">Probar</SubmitButton>
        </div>
      </label>
      {state && <p className="im-msg" data-ok={state.ok} role={state.ok ? "status" : "alert"}>{state.msg}</p>}
    </form>
  );
}
