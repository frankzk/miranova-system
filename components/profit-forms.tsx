"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { currencySymbol } from "@/lib/format";
import {
  CARRIERS, COST_CURRENCIES, FULFILLMENT_USD, costSymbol, parseMoney, suggestLinks, unitCosts, unitProfit,
  type CatalogItem, type Carrier, type CostCurrency, type MarketAccount, type ProfitProduct, type UnitProfit,
} from "@/lib/profit";
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
const pct = (m: number | null) => (m === null ? "" : ` (${Math.round(m * 100)}%)`);

type MarketState = { link: string; touched: boolean; carrier: string; transfer: string; pc: string; pu: string; qty: string };

/**
 * Ficha de costos de un producto: costos comunes (en dólares o quetzales) y, por cuenta, el producto
 * de la plataforma, el traslado, los precios comunidad y usuarios y la cantidad ingresada. Calcula
 * al escribir el costo total, lo puesto en el país y la rentabilidad por unidad.
 */
export function ProfitForm({
  action, v = {}, accounts, catalog, taken, observed, carrierDefaults, defaultFx, names,
}: {
  action: Action;
  v?: Partial<ProfitProduct>;
  accounts: MarketAccount[];
  /** productos de la plataforma que se pueden vincular */
  catalog: CatalogItem[];
  /** "cuenta|product_key" → ficha que ya lo tiene (no se ofrece en las demás) */
  taken: Record<string, string>;
  /** "cuenta|product_key" → precios más cobrados en Drop, de menor a mayor */
  observed: Record<string, number[]>;
  /** transportista más usado por país, para cuentas nuevas */
  carrierDefaults: Record<string, Carrier>;
  /** quetzales por dólar para una ficha nueva */
  defaultFx: number;
  names: string[];
}) {
  const [state, run] = useActionState(action, null);
  const sheet = useSheet();
  const uid = useId();
  const isNew = !v.id;
  const [name, setName] = useState(v.name ?? "");
  const [currency, setCurrency] = useState<CostCurrency>(v.cost_currency ?? "USD");
  const [fx, setFx] = useState(str(v.fx_gtq_per_usd ?? defaultFx));
  const [cost, setCost] = useState(str(v.unit_cost));
  const [imp, setImp] = useState(str(v.import_cost));
  const [pickup, setPickup] = useState(str(v.pickup_cost));

  const free = (c: CatalogItem) => {
    const owner = taken[`${c.account_id}|${c.product_key}`];
    return !owner || owner === v.id;
  };
  const optionsOf = (aid: string) => catalog.filter((c) => c.account_id === aid && free(c));
  const prices = (aid: string, key: string) => observed[`${aid}|${key}`] ?? [];
  const initial = (a: MarketAccount): MarketState => {
    const m = v.markets?.find((x) => x.account_id === a.id);
    const link = v.links?.find((l) => l.account_id === a.id)?.product_key ?? "";
    const seen = link && !m ? prices(a.id, link) : [];
    return {
      link,
      touched: !!link,
      carrier: m ? m.carrier ?? "" : a.country === "GT" ? "" : carrierDefaults[a.country ?? ""] ?? "",
      transfer: str(m?.transfer_cost),
      pc: str(m?.price_community ?? (seen.length === 2 ? seen[0] : null)),
      pu: str(m?.price_users ?? (seen.length ? seen[seen.length - 1] : null)),
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

  /** Al elegir el producto de una cuenta, si los precios están vacíos se proponen los cobrados en Drop. */
  const chooseLink = (aid: string, key: string, touched = true) =>
    setMarkets((cur) => {
      const m = cur[aid];
      const seen = key ? prices(aid, key) : [];
      return {
        ...cur,
        [aid]: {
          ...m, link: key, touched,
          pc: m.pc || (seen.length === 2 ? String(seen[0]) : ""),
          pu: m.pu || (seen.length ? String(seen[seen.length - 1]) : ""),
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
    fx_gtq_per_usd: val(fx),
    unit_cost: val(cost),
    import_cost: val(imp),
    pickup_cost: val(pickup),
  };
  const c = unitCosts(base);
  const sym = costSymbol(currency);

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
        <label className="field">
          <span>Moneda de los costos</span>
          <select className="select" name="cost_currency" value={currency} onChange={(e) => setCurrency(e.currentTarget.value as CostCurrency)}>
            {COST_CURRENCIES.map((x) => <option key={x.id} value={x.id}>{x.label} ({x.symbol})</option>)}
          </select>
        </label>
        {currency === "GTQ" ? (
          <label className="field">
            <span>Tipo de cambio <span className="hint">Q por USD</span></span>
            <input className="input" name="fx_gtq_per_usd" value={fx} onChange={(e) => setFx(e.currentTarget.value)} inputMode="decimal" placeholder="7.65" required />
          </label>
        ) : (
          <p className="pf-note">Traslado, recolección y costos van en dólares; los precios, en la moneda de cada cuenta.</p>
        )}
        <label className="field">
          <span>Costo <span className="hint">por unidad, {sym}</span></span>
          <input className="input" name="unit_cost" value={cost} onChange={(e) => setCost(e.currentTarget.value)} inputMode="decimal" placeholder="2.50" />
        </label>
        <label className="field">
          <span>Costo de importación <span className="hint">por unidad, si aplica</span></span>
          <input className="input" name="import_cost" value={imp} onChange={(e) => setImp(e.currentTarget.value)} inputMode="decimal" placeholder="0.00" />
        </label>
        <label className="field">
          <span>Recolección en Guatemala <span className="hint">por unidad, {sym}</span></span>
          <input className="input" name="pickup_cost" value={pickup} onChange={(e) => setPickup(e.currentTarget.value)} inputMode="decimal" placeholder="0.00" />
        </label>
        <p className="pf-calc wide">
          Costo total: <b>{c.cost_total === null ? "—" : usd(c.cost_total)}</b>
          {c.cost_total !== null && c.pickup > 0 && <> · con recolección <b>{usd(c.cost_total + c.pickup)}</b></>}
          {" "}· Fulfillment <b>{usd(FULFILLMENT_USD)}</b> por pedido (fijo)
          {currency === "GTQ" && base.fx_gtq_per_usd === null && <span className="hint"> · falta el tipo de cambio</span>}
        </p>
      </div>

      <div className="pf-markets">
        <p className="pf-markets-h">Por cuenta <span className="hint">traslado, precios y cantidad ingresada; solo donde se vende</span></p>
        {accounts.map((a) => {
          const m = markets[a.id];
          const options = optionsOf(a.id);
          const landed = unitCosts(base, { transfer_cost: val(m.transfer) }).landed;
          const comm = unitProfit(landed, val(m.pc), a.usd_rate);
          const users = unitProfit(landed, val(m.pu), a.usd_rate);
          const seen = m.link ? prices(a.id, m.link) : [];
          const cur = currencySymbol(a.currency);
          const active = !!(m.link || m.transfer || m.pc || m.pu || m.qty || extras.some((x) => x.account_id === a.id));
          return (
            <details key={a.id} className="pf-market" open={active || undefined}>
              <summary>
                <span className="n">{a.name}</span>
                <span className="s">
                  {m.link ? options.find((o) => o.product_key === m.link)?.name ?? "Producto vinculado" : "No vinculado"}
                  {users && <> · usuarios <b data-tone={users.profit < 0 ? "down" : undefined}>{usd(users.profit)}</b></>}
                </span>
              </summary>
              <div className="pf-market-body">
                <label className="field pf-span2">
                  <span>Producto en la plataforma</span>
                  <select className="select" name={`link_${a.id}`} value={m.link} onChange={(e) => chooseLink(a.id, e.currentTarget.value)}>
                    <option value="">— No se vende en esta cuenta —</option>
                    {options.map((o) => <option key={o.product_key} value={o.product_key}>{o.name}</option>)}
                  </select>
                </label>
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
                <label className="field">
                  <span>Traslado <span className="hint">por unidad, {sym}</span></span>
                  <input className="input" name={`m_${a.id}_transfer`} value={m.transfer} onChange={(e) => patch(a.id, { transfer: e.currentTarget.value })} inputMode="decimal" placeholder="0.00" />
                </label>
                <label className="field">
                  <span>Precio comunidad <span className="hint">{cur}</span></span>
                  <input className="input" name={`m_${a.id}_pc`} value={m.pc} onChange={(e) => patch(a.id, { pc: e.currentTarget.value })} inputMode="decimal" />
                </label>
                <label className="field">
                  <span>Precio usuarios <span className="hint">{cur}</span></span>
                  <input className="input" name={`m_${a.id}_pu`} value={m.pu} onChange={(e) => patch(a.id, { pu: e.currentTarget.value })} inputMode="decimal" />
                </label>
                <label className="field">
                  <span>Cantidad ingresada <span className="hint">unidades</span></span>
                  <input className="input" name={`m_${a.id}_qty`} value={m.qty} onChange={(e) => patch(a.id, { qty: e.currentTarget.value })} inputMode="numeric" pattern="[0-9][0-9,]*" placeholder="0" />
                </label>
                {seen.length > 0 && (
                  <p className="pf-seen pf-span2">
                    En Drop se cobró {seen.map((p) => `${cur}${p.toLocaleString("en-US")}`).join(" y ")} por unidad (últimos 60 días)
                    {seen.length === 2 ? ": el menor suele ser comunidad y el mayor usuarios." : "."}
                  </p>
                )}
                <p className="pf-calc pf-span2">
                  Costo final en {a.country ?? "el país"}: <b>{landed === null ? "—" : usd(landed + FULFILLMENT_USD)}</b>
                  {" "}· Comunidad <Profit p={comm} /> · Usuarios <Profit p={users} />
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
      <SubmitButton className="btn btn-primary" pending="Guardando…">{isNew ? "Guardar ficha" : "Guardar"}</SubmitButton>
    </StickyForm>
  );
}

function Profit({ p }: { p: UnitProfit | null }) {
  if (!p) return <b>—</b>;
  return <b data-tone={p.profit < 0 ? "down" : "up"}>{usd(p.profit)}{pct(p.margin)}</b>;
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
