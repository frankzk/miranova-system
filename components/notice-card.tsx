"use client";

import { useActionState, useState } from "react";
import { IconCheck, IconCopy, IconExternal } from "./icons";
import { SubmitButton } from "./submit-button";

type State = { ok: boolean; msg: string } | null;
type Action = (prev: State, form: FormData) => Promise<State>;

/** Copiar el mensaje, abrir el grupo y marcar el aviso enviado. */
export function NoticeActions({ action, batch, message, groupUrl, storeLink }: {
  action: Action; batch: string; message: string; groupUrl: string | null; storeLink: string | null;
}) {
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
    <div className="nt-actions">
      <button type="button" className="btn" onClick={copy}>{copied ? <><IconCheck /> Copiado</> : <><IconCopy /> Copiar mensaje</>}</button>
      {groupUrl ? (
        <a className="btn" href={groupUrl} target="_blank" rel="noreferrer"><IconExternal /> Abrir grupo</a>
      ) : storeLink && (
        <a className="btn btn-ghost" href={storeLink}>Cargar el grupo de WhatsApp</a>
      )}
      <form action={run}>
        <input type="hidden" name="batch" value={batch} />
        <SubmitButton className="btn btn-primary" pending="Guardando…">Marcar enviado</SubmitButton>
      </form>
      {state && <p className="im-msg" data-ok={state.ok} role={state.ok ? "status" : "alert"}>{state.msg}</p>}
    </div>
  );
}
