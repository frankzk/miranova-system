"use client";

import { useActionState, useEffect, useId, useState } from "react";
import {
  CARRIERS, COST_CURRENCIES, FULFILLMENT_USD, costSymbol, costToUsd, isCostCurrency, parseMoney, suggestLinks, unitCosts,
  type CatalogItem, type Carrier, type CostCurrency, type MarketAccount,
} from "@/lib/profit";
import type { CostProduct } from "@/lib/profit-access";
import { useSheet } from "./side-sheet";
import { StickyForm } from "./sticky-form";
import { SubmitButton } from "./submit-button";

type State = { ok: boolean; msg: string } | null;
type Action = (prev: State, form: FormData) => Promise<State>;

function Msg({ state }: { state: State }) {
  if (!state) return null;
  return <p className="im-msg" data-ok={state.ok} role={state.ok ? "status" : "alert"}>{state.msg}</p>;
}

const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
const val = (s: string) => {
  const n = parseMoney(s);
  return n === null || Number.isNaN(n) ? null : n;
};
const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type MarketState = { link: string; touched: boolean; carrier: string; transfer: string; transferCurrency: CostCurrency; collection: string; collectionCurrency: CostCurrency; qty: string };

function CostEntry({ label, name, amount, currency, onAmount, onCurrency, rates }: {
  label: string; name: string; amount: string; currency: CostCurrency;
  onAmount: (value: string) => void; onCurrency: (value: CostCurrency) => void;
  rates: { fx_gtq_per_usd: number | null; fx_hnl_per_usd: number | null };
}) {
  const id = useId();
  const converted = costToUsd({ cost_currency: currency, ...rates }, val(amount));
  return <fieldset className="field pf-cost-entry"><legend>{label} <span className="hint">por unidad</span></legend>
    <div className="pf-cost-inputs">
      <label className="sr-only" htmlFor={`${id}-amount`}>Importe de {label.toLowerCase()}</label>
      <input id={`${id}-amount`} className="input" name={name} value={amount} onChange={(e) => onAmount(e.currentTarget.value)} inputMode="decimal" placeholder="0.00" />
      <label className="sr-only" htmlFor={`${id}-currency`}>Moneda de {label.toLowerCase()}</label>
      <select id={`${id}-currency`} className="select" name={name === "unit_cost" ? "cost_currency" : name.replace(/_cost$/, "_currency").replace(/_(transfer|collection)$/, "_$1_currency")}
        value={currency} onChange={(e) => onCurrency(e.currentTarget.value as CostCurrency)}>
        {COST_CURRENCIES.map((c) => <option value={c.id} key={c.id}>{c.id} ({c.symbol})</option>)}
      </select>
    </div>
    <span className="hint">{amount ? converted === null ? "Falta tasa sincronizada" : `Equivale a ${usd(converted)} USD` : "Selecciona la moneda en que se paga este costo"}</span>
  </fieldset>;
}

/**
 * Ficha de costos de un producto: costos comunes (en dólares o quetzales) y, por cuenta, el producto
 * de la plataforma, el traslado y la cantidad ingresada. Calcula el costo puesto en cada país.
 */
export function ProfitForm({
  action, v = {}, accounts, catalog, taken, carrierDefaults, defaultFx, defaultHnlFx, names,
}: {
  action: Action;
  v?: Partial<CostProduct>;
  accounts: MarketAccount[];
  /** productos de la plataforma que se pueden vincular */
  catalog: CatalogItem[];
  /** "cuenta|product_key" → ficha que ya lo tiene (no se ofrece en las demás) */
  taken: Record<string, string>;
  /** transportista más usado por país, para cuentas nuevas */
  carrierDefaults: Record<string, Carrier>;
  /** quetzales por dólar para una ficha nueva */
  defaultFx: number | null;
  defaultHnlFx: number | null;
  names: string[];
}) {
  const [state, run] = useActionState(action, null);
  const sheet = useSheet();
  const uid = useId();
  const isNew = !v.id;
  const [name, setName] = useState(v.name ?? "");
  const [currency, setCurrency] = useState<CostCurrency>(v.cost_currency ?? "USD");
  const rates = { fx_gtq_per_usd: defaultFx, fx_hnl_per_usd: defaultHnlFx };
  const [importCurrency, setImportCurrency] = useState<CostCurrency>(v.import_currency ?? v.cost_currency ?? "USD");
  const [pickupCurrency, setPickupCurrency] = useState<CostCurrency>(v.pickup_currency ?? v.cost_currency ?? "USD");
  const [cost, setCost] = useState(str(v.unit_cost));
  const [imp, setImp] = useState(str(v.import_cost));
  const [pickup, setPickup] = useState(str(v.pickup_cost));

  const free = (c: CatalogItem) => {
    const owner = taken[`${c.account_id}|${c.product_key}`];
    return !owner || owner === v.id;
  };
  const optionsOf = (aid: string) => catalog.filter((c) => c.account_id === aid);
  const initial = (a: MarketAccount): MarketState => {
    const m = v.markets?.find((x) => x.account_id === a.id);
    const link = v.links?.find((l) => l.account_id === a.id)?.product_key ?? "";
    return {
      link,
      touched: !!link,
      carrier: m ? m.carrier ?? "" : a.country === "GT" ? "" : carrierDefaults[a.country ?? ""] ?? "",
      transfer: str(m?.transfer_cost),
      transferCurrency: m?.transfer_currency ?? v.cost_currency ?? "USD",
      collection: str(m?.collection_cost),
      collectionCurrency: m?.collection_currency ?? m?.transfer_currency ?? (isCostCurrency(a.currency) ? a.currency : v.cost_currency ?? "USD"),
      qty: str(m?.qty_in),
    };
  };
  const [markets, setMarkets] = useState<Record<string, MarketState>>(() => Object.fromEntries(accounts.map((a) => [a.id, initial(a)])));
  // otros productos de la misma cuenta además del principal (llegan desde "Vincular a una ficha")
  const [extras] = useState(() => (v.links ?? []).filter((l) => (v.links ?? []).find((x) => x.account_id === l.account_id) !== l));

  useEffect(() => {
    if (state?.ok) sheet?.close();
  }, [state, sheet]);

  // ficha nueva que ya trae nombre (desde "Entregados sin ficha"): propone las demás cuentas al abrir
  useEffect(() => {
    suggest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = (aid: string, p: Partial<MarketState>) => setMarkets((cur) => ({ ...cur, [aid]: { ...cur[aid], ...p } }));

  /** El producto elegido es independiente de los precios comerciales. */
  const chooseLink = (aid: string, key: string, touched = true) =>
    setMarkets((cur) => {
      const m = cur[aid];
      return {
        ...cur,
        [aid]: {
          ...m, link: key, touched,
        },
      };
    });

  /** Ficha nueva: con el nombre escrito, propone el producto parecido de cada cuenta que nadie eligió. */
  const suggest = () => {
    if (!isNew || !name.trim()) return;
    const hits = suggestLinks(name, catalog.filter(free));
    for (const a of accounts) {
      const hit = hits.get(a.id);
      if (hit && !markets[a.id].touched && !markets[a.id].link) chooseLink(a.id, hit.product_key, false);
    }
  };

  const base = {
    cost_currency: currency,
    ...rates,
    import_currency: importCurrency,
    pickup_currency: pickupCurrency,
    unit_cost: val(cost),
    import_cost: val(imp),
    pickup_cost: val(pickup),
  };
  const c = unitCosts(base);
  const needsRate = (cur: CostCurrency) => cur === "GTQ" ? !defaultFx : cur === "HNL" ? !defaultHnlFx : false;
  const missingRate = needsRate(currency) || ((val(imp) ?? 0) > 0 && needsRate(importCurrency)) || ((val(pickup) ?? 0) > 0 && needsRate(pickupCurrency)) || Object.values(markets).some((m) => ((val(m.transfer) ?? 0) > 0 && needsRate(m.transferCurrency)) || ((val(m.collection) ?? 0) > 0 && needsRate(m.collectionCurrency)));

  return (
    <StickyForm state={state} action={run} className="im-form pf-form">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <div className="im-grid">
        <label className="field wide">
          <span>Producto</span>
          <input
            className="input" name="name" value={name} onChange={(e) => setName(e.currentTarget.value)} onBlur={suggest}
            maxLength={160} required list={`${uid}-names`} autoComplete="off" placeholder="Ej.: Drenaje linfático en gotas 100 ml"
          />
        </label>
        <CostEntry label="Compra del producto" name="unit_cost" amount={cost} currency={currency} onAmount={setCost} onCurrency={setCurrency} rates={rates} />
        <CostEntry label="Importación" name="import_cost" amount={imp} currency={importCurrency} onAmount={setImp} onCurrency={setImportCurrency} rates={rates} />
        <CostEntry label="Recolección en Guatemala" name="pickup_cost" amount={pickup} currency={pickupCurrency} onAmount={setPickup} onCurrency={setPickupCurrency} rates={rates} />
        <p className="pf-note wide">Conversión automática: {defaultFx ? "Q" + defaultFx + " por USD" : "GTQ pendiente de sincronizar"} · {defaultHnlFx ? "L" + defaultHnlFx + " por USD" : "HNL pendiente de sincronizar"}. Cada importe se convierte por separado usando las tasas sincronizadas.</p>
        <p className="pf-calc wide">
          Costo total: <b>{c.cost_total === null ? "—" : usd(c.cost_total)}</b>
          {c.cost_total !== null && c.pickup !== null && c.pickup > 0 && <> · con recolección <b>{usd(c.cost_total + c.pickup)}</b></>}
          {" "}· Fulfillment <b>{usd(FULFILLMENT_USD)}</b> por pedido (fijo)
          {missingRate && <span className="hint"> · falta una tasa sincronizada para los costos seleccionados</span>}
        </p>
      </div>

      <div className="pf-markets">
        <p className="pf-markets-h">Por cuenta <span className="hint">traslado, recolecta y cantidad ingresada; solo donde se vende</span></p>
        {accounts.map((a) => {
          const m = markets[a.id];
          const options = optionsOf(a.id);
          const landed = unitCosts(base, { transfer_cost: val(m.transfer), transfer_currency: m.transferCurrency, collection_cost: val(m.collection), collection_currency: m.collectionCurrency }).landed;
          const active = !!(m.link || m.transfer || m.collection || m.qty || extras.some((x) => x.account_id === a.id));
          return (
            <details key={a.id} className="pf-market" open={active || undefined}>
              <summary>
                <span className="n">{a.name}</span>
                <span className="s">
                  {m.link ? options.find((o) => o.product_key === m.link)?.name ?? "Producto vinculado" : "No vinculado"}
                </span>
              </summary>
              <div className="pf-market-body">
                <label className="field pf-span2">
                  <span>Producto en la plataforma</span>
                  <select className="select" name={`link_${a.id}`} value={m.link} onChange={(e) => chooseLink(a.id, e.currentTarget.value)}>
                    <option value="">— No se vende en esta cuenta —</option>
                    {options.map((o) => <option key={o.product_key} value={o.product_key} disabled={!free(o)}>{o.name}{!free(o) ? " · Ya vinculado a otra ficha" : ""}</option>)}
                  </select>
                </label>
                <p className="hint pf-span2">Si el producto indica «Ya vinculado», edita su ficha existente en Costos de productos.</p>
                {extras.filter((x) => x.account_id === a.id).map((x) => (
                  <label key={x.product_key} className="check pf-span2">
                    <input type="checkbox" name="links_extra" value={`${a.id}|${x.product_key}`} defaultChecked />
                    <span>También: {catalog.find((o) => o.account_id === a.id && o.product_key === x.product_key)?.name ?? x.product_key}</span>
                  </label>
                ))}
                <label className="field">
                  <span>Transportista</span>
                  <select className="select" name={`m_${a.id}_carrier`} value={m.carrier} onChange={(e) => patch(a.id, { carrier: e.currentTarget.value })}>
                    <option value="">{a.country === "GT" ? "Sin traslado" : "—"}</option>
                    {CARRIERS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </select>
                </label>
                <CostEntry label={"Traslado a " + a.name} name={`m_${a.id}_transfer`} amount={m.transfer} currency={m.transferCurrency}
                  onAmount={(value) => patch(a.id, { transfer: value })} onCurrency={(value) => patch(a.id, { transferCurrency: value })} rates={rates} />
                <CostEntry label="Recolecta" name={`m_${a.id}_collection`} amount={m.collection} currency={m.collectionCurrency}
                  onAmount={(value) => patch(a.id, { collection: value })} onCurrency={(value) => patch(a.id, { collectionCurrency: value })} rates={rates} />
                <label className="field">
                  <span>Cantidad ingresada <span className="hint">unidades</span></span>
                  <input className="input" name={`m_${a.id}_qty`} value={m.qty} onChange={(e) => patch(a.id, { qty: e.currentTarget.value })} inputMode="numeric" pattern="[0-9][0-9,]*" placeholder="0" />
                </label>
                <p className="pf-calc pf-span2">
                  Costo final en {a.country ?? "el país"}: <b>{landed === null ? "—" : usd(landed + FULFILLMENT_USD)}</b>
                  {!a.usd_rate && <span className="hint"> · sin tipo de cambio de esta cuenta todavía</span>}
                </p>
              </div>
            </details>
          );
        })}
      </div>

      <label className="field">
        <span>Notas <span className="hint">opcional</span></span>
        <textarea className="input" name="notes" rows={2} defaultValue={v.notes ?? ""} maxLength={2000} />
      </label>
      <datalist id={`${uid}-names`}>{names.map((n) => <option key={n} value={n} />)}</datalist>
      <Msg state={state} />
      <SubmitButton className="btn btn-primary" pending="Guardando…" disabled={missingRate}>{isNew ? "Guardar ficha" : "Guardar"}</SubmitButton>
    </StickyForm>
  );
}


export function DeleteProfitForm({ action, id, label }: { action: Action; id: string; label: string }) {
  const [state, run] = useActionState(action, null);
  const sheet = useSheet();
  useEffect(() => {
    if (state?.ok) sheet?.close();
  }, [state, sheet]);
  return (
    <StickyForm state={state} action={run} className="im-inline" onSubmit={(e) => { if (!window.confirm(`¿Borrar la ficha de ${label}? Lo entregado de ese producto queda sin costo.`)) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton className="btn btn-ghost btn-sm btn-danger" pending="Borrando…">Borrar ficha</SubmitButton>
      <Msg state={state} />
    </StickyForm>
  );
}

/** "Entregados sin ficha": vincular el producto a una ficha que ya existe. */
export function LinkProfitForm({ action, accountId, productKey, products }: {
  action: Action;
  accountId: string;
  productKey: string;
  products: { id: string; name: string }[];
}) {
  const [state, run] = useActionState(action, null);
  if (!products.length) return null;
  return (
    <form action={run} className="pf-link">
      <input type="hidden" name="account_id" value={accountId} />
      <input type="hidden" name="product_key" value={productKey} />
      <select className="select" name="product_id" defaultValue="" aria-label="Ficha a la que pertenece" required>
        <option value="" disabled>Es el producto de…</option>
        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <SubmitButton className="btn btn-sm" pending="…">Vincular</SubmitButton>
      {state && <p className="im-msg" data-ok={state.ok} role={state.ok ? "status" : "alert"}>{state.msg}</p>}
    </form>
  );
}
