"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { SubmitButton } from "./submit-button";

export type RestockState = { ok: boolean; msg: string } | null;
type Action = (prev: RestockState, form: FormData) => Promise<RestockState>;

function Msg({ state }: { state: RestockState }) {
  if (!state) return null;
  return <p className="rs-msg" data-ok={state.ok} role={state.ok ? "status" : "alert"}>{state.msg}</p>;
}

/** "Ya lo pedí": unidades pedidas y llegada estimada. Al guardar se cierra el panel (`closeHref`). */
export function RestockOrderForm({
  action, accountId, productId, suggested, eta, today, closeHref,
}: { action: Action; accountId: string; productId: string; suggested: number; eta: string; today: string; closeHref: string }) {
  const [state, run] = useActionState(action, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.push(closeHref, { scroll: false });
  }, [state, router, closeHref]);
  return (
    <form action={run} className="rs-form">
      <input type="hidden" name="account_id" value={accountId} />
      <input type="hidden" name="product_id" value={productId} />
      <div className="rs-grid">
        <label className="field">
          <span>Unidades pedidas</span>
          <input className="input" name="units" type="number" min={1} step={1} inputMode="numeric" required defaultValue={suggested > 0 ? suggested : undefined} />
        </label>
        <label className="field">
          <span>Llegada estimada</span>
          <input className="input" name="eta" type="date" min={today} defaultValue={eta} />
        </label>
        <label className="field wide">
          <span>Nota<span className="hint">opcional</span></span>
          <input className="input" name="note" maxLength={300} placeholder="Proveedor, número de pedido…" />
        </label>
      </div>
      <Msg state={state} />
      <SubmitButton className="btn btn-primary" pending="Guardando…">Guardar pedido</SubmitButton>
    </form>
  );
}

/** Cancela un pedido que ya no viene (deja de contar como en camino). */
export function CancelRestockForm({ action, orderId }: { action: Action; orderId: string }) {
  const [state, run] = useActionState(action, null);
  return (
    <form action={run} className="rs-inline">
      <input type="hidden" name="order_id" value={orderId} />
      <SubmitButton className="btn btn-ghost btn-sm" pending="Cancelando…">Cancelar pedido</SubmitButton>
      {state && !state.ok && <Msg state={state} />}
    </form>
  );
}

/** Días que tarda en llegar una reposición de este producto. Vacío: vuelve al medido o al estándar. */
export function LeadTimeForm({
  action, accountId, productId, current, manual,
}: { action: Action; accountId: string; productId: string; current: number; manual: boolean }) {
  const [state, run] = useActionState(action, null);
  return (
    <form action={run} className="rs-form">
      <input type="hidden" name="account_id" value={accountId} />
      <input type="hidden" name="product_id" value={productId} />
      <div className="rs-lead">
        <label className="field">
          <span>Días que tarda en llegar</span>
          <input className="input" name="lead_days" type="number" min={1} max={180} step={1} inputMode="numeric"
            defaultValue={manual ? current : undefined} placeholder={String(current)} />
        </label>
        <SubmitButton className="btn" pending="Guardando…">Guardar</SubmitButton>
      </div>
      {manual && <p className="rs-hint">Déjalo vacío y guarda para volver a lo medido con los pedidos que llegan.</p>}
      <Msg state={state} />
    </form>
  );
}

/** "Enviar resumen ahora": manda el correo diario en el momento, para probarlo. */
export function SendDigestForm({ action }: { action: Action }) {
  const [state, run] = useActionState(action, null);
  return (
    <form action={run} className="rs-digest">
      <SubmitButton className="btn" pending="Enviando…">Enviar resumen ahora</SubmitButton>
      <Msg state={state} />
    </form>
  );
}
