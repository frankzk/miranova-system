"use client";

import { useActionState, useState } from "react";
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

/** Dos claves que van juntas (FedEx: API Key y Secret Key; UPS: Client ID y Client Secret). */
function PairField({ name, label, idLabel, secretLabel, idThe, secretThe, id, secret, help }: {
  name: string; label: string; idLabel: string; secretLabel: string;
  /** con artículo, para "Falta la Secret Key" / "Falta el Client ID" */
  idThe: string; secretThe: string;
  id: Status; secret: Status; help: React.ReactNode;
}) {
  const both = id.source && secret.source;
  const panel = id.source === "panel" || secret.source === "panel";
  return (
    <div className="field int-field">
      <span>{label}</span>
      <p className="int-state" data-on={both ? true : undefined}>
        <span className="dot" data-tone={both ? "success" : id.source || secret.source ? "warning" : "neutral"} aria-hidden />
        {both && <>{id.source === "vercel" && secret.source === "vercel" ? "Configuradas en Vercel" : "Guardadas aquí"} · {idLabel} termina en <b>{id.tail}</b></>}
        {!both && (id.source || secret.source) && <>Falta {id.source ? secretThe : idThe}</>}
        {!id.source && !secret.source && <>Sin claves</>}
      </p>
      <div className="int-pair">
        <input className="input" name={`${name}_id_key`} type="password" autoComplete="off" spellCheck={false} placeholder={id.source ? `${idLabel}: escribe una nueva para cambiarla` : idLabel} aria-label={`${label}: ${idLabel}`} />
        <input className="input" name={`${name}_secret_key`} type="password" autoComplete="off" spellCheck={false} placeholder={secret.source ? `${secretLabel}: escribe una nueva para cambiarla` : secretLabel} aria-label={`${label}: ${secretLabel}`} />
      </div>
      {panel && (
        <label className="int-clear"><input type="checkbox" name={`${name}_clear`} value="1" /> Borrar las claves guardadas</label>
      )}
      <div className="hint">{help}</div>
    </div>
  );
}

type AllStatus = Record<"dhl" | "fedex_id" | "fedex_secret" | "ups_id" | "ups_secret" | "track17" | "anthropic", Status>;

export function IntegrationsForm({ action, status }: { action: Action; status: AllStatus }) {
  const { dhl, track17, anthropic } = status;
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
      <PairField
        name="fedex"
        label="FedEx · seguimiento de guías FedEx (gratis)"
        idLabel="API Key"
        secretLabel="Secret Key"
        idThe="la API Key"
        secretThe="la Secret Key"
        id={status.fedex_id}
        secret={status.fedex_secret}
        help={
          <>
            En <b>developer.fedex.com</b> inicia sesión con tu usuario de fedex.com → <b>My Projects</b> → <b>Create API Project</b>, elige{" "}
            <b>Track API</b> y, en la pestaña <b>Production Key</b>, copia la <b>API Key</b> y la <b>Secret Key</b>. Puede pedirte asociar un número de cuenta FedEx.
          </>
        }
      />
      <PairField
        name="ups"
        label="UPS · seguimiento de guías UPS (gratis)"
        idLabel="Client ID"
        secretLabel="Client Secret"
        idThe="el Client ID"
        secretThe="el Client Secret"
        id={status.ups_id}
        secret={status.ups_secret}
        help={
          <>
            En <b>developer.ups.com</b> inicia sesión con tu usuario de ups.com → <b>Create Application</b>, agrega la API <b>Tracking</b> y copia el{" "}
            <b>Client ID</b> y el <b>Client Secret</b> de la app. Puede pedirte asociar un número de cuenta UPS.
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

/** Probar una paquetera con una guía real: muestra lo que responde, sin guardar nada. */
export function TrackTestForm({ action, carriers }: { action: Action; carriers: { id: string; label: string }[] }) {
  const [state, run] = useActionState(action, null);
  // la paquetera elegida se mantiene después de probar (el formulario se limpia solo)
  const [carrier, setCarrier] = useState(carriers[0]?.id ?? "");
  return (
    <form action={run} className="int-test">
      <label className="field">
        <span>Consultar una guía con la clave guardada</span>
        <div className="int-test-row">
          <select className="select" name="carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} aria-label="Paquetera">
            {carriers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <input className="input" name="number" required autoComplete="off" spellCheck={false} placeholder="Número de guía" maxLength={40} aria-label="Número de guía" />
          <SubmitButton className="btn" pending="Consultando…">Probar</SubmitButton>
        </div>
      </label>
      {state && <p className="im-msg" data-ok={state.ok} role={state.ok ? "status" : "alert"}>{state.msg}</p>}
    </form>
  );
}
