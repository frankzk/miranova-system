"use client";

import { useActionState, useEffect } from "react";
import { currencySymbol } from "@/lib/format";
import type { PriceProduct } from "@/lib/profit-access";
import type { MarketAccount } from "@/lib/profit";
import { useSheet } from "./side-sheet";
import { StickyForm } from "./sticky-form";
import { SubmitButton } from "./submit-button";

type State = { ok: boolean; msg: string } | null;
export function ProductPricesForm({ product, accounts, action }: {
  product: PriceProduct;
  accounts: Pick<MarketAccount, "id" | "name" | "currency">[];
  action: (prev: State, form: FormData) => Promise<State>;
}) {
  const [state, run] = useActionState(action, null);
  const sheet = useSheet();
  useEffect(() => { if (state?.ok) sheet?.close(); }, [state, sheet]);
  return <StickyForm action={run} state={state} className="im-form">
    <input type="hidden" name="id" value={product.id} />
    <p className="muted">Precios por unidad en la moneda de cada cuenta. Deja vacío un precio que todavía no esté definido.</p>
    {accounts.map((a) => {
      const m = product.markets.find((m) => m.account_id === a.id);
      return <fieldset key={a.id} className="im-grid">
        <legend>{a.name} · {a.currency}</legend>
        <label className="field"><span>Precio comunidad ({currencySymbol(a.currency)})</span>
          <input className="input" name={`m_${a.id}_pc`} defaultValue={m?.price_community ?? ""} inputMode="decimal" /></label>
        <label className="field"><span>Precio usuarios ({currencySymbol(a.currency)})</span>
          <input className="input" name={`m_${a.id}_pu`} defaultValue={m?.price_users ?? ""} inputMode="decimal" /></label>
      </fieldset>;
    })}
    {state && <p className="im-msg" data-ok={state.ok} role={state.ok ? "status" : "alert"}>{state.msg}</p>}
    <SubmitButton className="btn btn-primary" pending="Guardando…">Guardar precios</SubmitButton>
  </StickyForm>;
}
