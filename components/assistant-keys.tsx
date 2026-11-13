"use client";

import { useActionState, useEffect, useState } from "react";
import { ASSISTANT_SCOPES, DEFAULT_SCOPES, scopeLabel, type AssistantScope } from "@/lib/assistant-scopes";
import { IconCheck, IconCopy } from "./icons";
import type { ImportFormState } from "./import-forms";
import { RemoveButton } from "./import-forms";
import { StickyForm } from "./sticky-form";
import { SubmitButton } from "./submit-button";

export type KeyFormState = { ok: boolean; msg: string; key?: string } | null;
type CreateAction = (prev: KeyFormState, form: FormData) => Promise<KeyFormState>;
type Action = (prev: ImportFormState, form: FormData) => Promise<ImportFormState>;

export type KeyRow = { id: string; name: string; key_tail: string; scopes: AssistantScope[]; created: string; used: string | null; revoked: boolean };

/** Casillas de lo que puede ver la llave. */
function ScopeChecks({ initial }: { initial: readonly AssistantScope[] }) {
  return (
    <fieldset className="ak-scopes">
      <legend>Qué puede ver</legend>
      {ASSISTANT_SCOPES.map((s) => (
        <label key={s.id}>
          <input type="checkbox" name="scope" value={s.id} defaultChecked={initial.includes(s.id)} />
          <span><b>{s.label}</b><span>{s.hint}</span></span>
        </label>
      ))}
    </fieldset>
  );
}

/** Cambiar lo que puede ver una llave ya creada. */
function ScopesForm({ action, k }: { action: Action; k: KeyRow }) {
  const [state, run] = useActionState(action, null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (state?.ok) setOpen(false); }, [state]);
  if (!open) {
    return (
      <div className="ak-scope-view">
        <span>{k.scopes.map(scopeLabel).join(" · ")}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Cambiar</button>
        {state?.ok && <span className="ak-saved" role="status"><IconCheck /> Guardado</span>}
      </div>
    );
  }
  return (
    <StickyForm state={state} action={run} className="ak-scope-form">
      <input type="hidden" name="id" value={k.id} />
      <ScopeChecks initial={k.scopes} />
      {state && !state.ok && <p className="form-error" role="alert">{state.msg}</p>}
      <div className="ak-actions">
        <SubmitButton className="btn btn-primary btn-sm" pending="Guardando…">Guardar permisos</SubmitButton>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </StickyForm>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="field ak-copy">
      <span>{label}</span>
      <div className="ak-copy-row">
        <input className="input" readOnly value={value} onFocus={(e) => e.currentTarget.select()} aria-label={label} spellCheck={false} />
        <button
          type="button"
          className="btn"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setDone(true);
              setTimeout(() => setDone(false), 1600);
            } catch {
              window.prompt(label, value);
            }
          }}
        >
          {done ? <><IconCheck /> Copiado</> : <><IconCopy /> Copiar</>}
        </button>
      </div>
    </div>
  );
}

/** Crear una llave: se muestra una sola vez, con la dirección del MCP ya armada. */
export function NewAssistantKeyForm({ action, base }: { action: CreateAction; base: string }) {
  const [state, run] = useActionState(action, null);
  return (
    <div className="ak-new">
      <StickyForm state={state} action={run} className="ak-form">
        <label className="field">
          <span>Nombre</span>
          <input className="input" name="name" defaultValue="Grok" maxLength={60} required autoComplete="off" />
        </label>
        <ScopeChecks initial={DEFAULT_SCOPES} />
        <SubmitButton className="btn btn-primary" pending="Creando…">Crear llave</SubmitButton>
      </StickyForm>
      {state && !state.ok && <p className="form-error" role="alert">{state.msg}</p>}
      {state?.ok && state.key && (
        <div className="ak-created" role="status">
          <p><b>Llave creada.</b> Cópiala ahora: no se vuelve a mostrar.</p>
          <CopyField label="Dirección con la llave (para Grok: Nuevo conector → Personalizado)" value={`${base}/${state.key}`} />
          <details>
            <summary>Si el asistente pide la dirección y la llave por separado</summary>
            <CopyField label="Dirección" value={base} />
            <CopyField label="Llave (Bearer)" value={state.key} />
          </details>
        </div>
      )}
    </div>
  );
}

export function AssistantKeyList({ keys, revoke, scopes }: { keys: KeyRow[]; revoke: Action; scopes: Action }) {
  if (!keys.length) return <p className="subtle">Todavía no hay llaves.</p>;
  return (
    <table className="table stack ak-table">
      <thead><tr><th>Nombre</th><th>Puede ver</th><th>Creada</th><th>Último uso</th><th><span className="sr-only">Acciones</span></th></tr></thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k.id} data-off={k.revoked || undefined}>
            <td data-slot="id"><span className="strong">{k.name}</span><div className="sub">mnv_…{k.key_tail}</div></td>
            <td className="ak-scope-cell">{k.revoked ? <span className="subtle">{k.scopes.map(scopeLabel).join(" · ")}</span> : <ScopesForm action={scopes} k={k} />}</td>
            <td className="nowrap">{k.created}</td>
            <td className="nowrap">{k.used ?? <span className="subtle">Nunca</span>}</td>
            <td className="r">
              {k.revoked ? <span className="pill" data-tone="neutral">Revocada</span> : (
                <RemoveButton action={revoke} name="id" value={k.id} label="Revocar" confirmText={`¿Revocar la llave "${k.name}"? El asistente que la usa deja de tener acceso.`} />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
