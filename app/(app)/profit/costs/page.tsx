import Link from "next/link";
import { IconPlus, IconSearch } from "@/components/icons";
import { DeleteProfitForm, ProfitForm } from "@/components/profit-forms";
import { ProfitSubnav } from "@/components/profit-subnav";
import { SideSheet } from "@/components/side-sheet";
import { PageHead } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { currencySymbol, fmtInt, todayIn } from "@/lib/format";
import { defaultGtqRate } from "@/lib/lab-purchases-data";
import {
  addDays, carrierLabel, costSymbol, FULFILLMENT_USD, marketEconomics, normName, observedAll, profitPeriod, unitCosts, windowStart,
  type Carrier, type MarketAccount, type ProfitProduct, type UnitProfit,
} from "@/lib/profit";
import { listProfitProducts, marketAccounts, profitCatalog, profitDelivered } from "@/lib/profit-data";
import { deleteProfitProduct, saveProfitProduct } from "../actions";
import "../../imports/imports.css";
import "../profit.css";

export const metadata = { title: "Costos por producto" };

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};

const usd = (n: number | null) =>
  n === null ? "—" : `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const local = (n: number | null, currency: string) => (n === null ? "—" : `${currencySymbol(currency)}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
const money = (n: number | null, c: ProfitProduct["cost_currency"]) => (n === null ? null : `${costSymbol(c)}${n.toLocaleString("en-US", { maximumFractionDigits: 4 })}`);

/** Rentabilidad por unidad a ese precio (y el precio, en la moneda de la cuenta y en dólares). */
function PriceCell({ price, p, currency }: { price: number | null; p: UnitProfit | null; currency: string }) {
  if (price === null) return <span className="subtle">—</span>;
  return (
    <>
      {p ? (
        <>
          <b data-tone={p.profit < 0 ? "down" : undefined}>{usd(p.profit)}</b>
          {p.margin !== null && <span className="pf-pct"> {Math.round(p.margin * 100)}%</span>}
        </>
      ) : <span className="subtle">—</span>}
      <div className="sub">{local(price, currency)}{p && currency !== "USD" && <> · {usd(p.price_usd)}</>}</div>
    </>
  );
}

export default async function ProfitCostsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [, sp] = await Promise.all([requirePermission("profit"), searchParams]);
  const today = todayIn();
  // misma ventana que el Resumen por defecto: comparten la caché
  const [accounts, products, fx, data] = await Promise.all([
    marketAccounts(),
    listProfitProducts(),
    defaultGtqRate().catch(() => 7.75),
    profitDelivered(windowStart(today, profitPeriod("mes", today)), "delivered"),
  ]);
  const catalog = await profitCatalog(data);
  const observed = observedAll(data.rows, addDays(today, -59));
  const taken: Record<string, string> = {};
  for (const p of products) for (const l of p.links) taken[`${l.account_id}|${l.product_key}`] = p.id;
  // transportista más usado en cada país, para proponerlo en las cuentas nuevas
  const country = new Map(accounts.map((a) => [a.id, a.country ?? ""]));
  const votes = new Map<string, Map<Carrier, number>>();
  for (const p of products) for (const m of p.markets) if (m.carrier) {
    const c = country.get(m.account_id) ?? "";
    const v = votes.get(c) ?? new Map<Carrier, number>();
    v.set(m.carrier, (v.get(m.carrier) ?? 0) + 1);
    votes.set(c, v);
  }
  const carrierDefaults = Object.fromEntries([...votes].map(([c, v]) => [c, [...v].sort((a, b) => b[1] - a[1])[0][0]])) as Record<string, Carrier>;
  const names = [...new Set([...products.map((p) => p.name), ...catalog.map((c) => c.name)])].sort((a, b) => a.localeCompare(b, "es"));

  const q = one(sp, "q")?.slice(0, 120);
  const needle = q ? normName(q) : "";
  const rows = needle ? products.filter((p) => normName(p.name).includes(needle)) : products;

  // "Crear ficha" desde Entregados sin ficha: viene con el producto de la plataforma elegido
  const nuevo = one(sp, "nuevo");
  const seed = nuevo ? catalog.find((c) => `${c.account_id}|${c.product_key}` === nuevo && !taken[nuevo]) : undefined;
  const form = (v?: Partial<ProfitProduct>) => (
    <ProfitForm
      action={saveProfitProduct} v={v} accounts={accounts} catalog={catalog} taken={taken} observed={observed}
      carrierDefaults={carrierDefaults} defaultFx={fx} names={names}
    />
  );

  const accountOf = (id: string): MarketAccount | undefined => accounts.find((a) => a.id === id);
  const missingCost = products.filter((p) => p.unit_cost === null).length;
  let investment = 0;
  for (const p of products) for (const m of p.markets) investment += marketEconomics(p, m, accountOf(m.account_id)?.usd_rate ?? null).investment ?? 0;

  return (
    <div className="page pf-page">
      <PageHead
        title="Costos por producto"
        sub={<>
          {fmtInt(products.length)} {products.length === 1 ? "ficha" : "fichas"}
          {missingCost > 0 && <> · {fmtInt(missingCost)} sin costo</>}
          {investment > 0 && <> · inventario ingresado {usd(investment)}</>}
          {" "}· costo, recolección, traslado y precios por cuenta
        </>}
        actions={
          <SideSheet
            trigger={<><IconPlus /> Nueva ficha</>} triggerClass="btn btn-primary" hash="nueva"
            title="Nueva ficha de costos" sub="Costos del producto y, en cada cuenta, traslado, precios y cantidad ingresada"
          >
            {form(seed ? { name: seed.name, links: [{ account_id: seed.account_id, product_key: seed.product_key }] } : undefined)}
          </SideSheet>
        }
      />
      <ProfitSubnav sheets={products.length} />

      <div className="pf-toolbar">
        <form className="rq-search pf-search" action="/profit/costs" role="search">
          <label className="input-icon">
            <IconSearch />
            <input className="input" type="search" name="q" defaultValue={q} placeholder="Buscar producto" aria-label="Buscar ficha" />
          </label>
        </form>
        {q && <Link className="btn btn-ghost btn-sm" href="/profit/costs">Ver todas</Link>}
      </div>

      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty">
            <h3>{products.length ? "Ninguna ficha con ese nombre" : "Aún no hay fichas de costos"}</h3>
            <p>
              {products.length
                ? "Prueba con otra palabra."
                : "Crea una ficha por producto: costo, importación (si aplica), recolección en Guatemala y, por cuenta, el traslado, el precio comunidad y el de usuarios. El panel propone el producto de Drop de cada país y los precios que ya se cobraron."}
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table pf-table pf-costs">
              <thead>
                <tr>
                  <th>Producto · cuenta</th>
                  <th className="r">Costo total</th>
                  <th className="r">Recolección GT</th>
                  <th className="r">Traslado</th>
                  <th className="r" title={`Costo total + recolección + traslado + fulfillment (${usd(FULFILLMENT_USD)} por pedido, fijo)`}>
                    Costo final<span className="th-sub">con fulfillment {usd(FULFILLMENT_USD)}</span>
                  </th>
                  <th className="r">Comunidad<span className="th-sub">rentabilidad · precio</span></th>
                  <th className="r">Usuarios<span className="th-sub">rentabilidad · precio</span></th>
                  <th className="r">Cant. ingresada</th>
                  <th><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              {rows.map((p) => {
                const c = unitCosts(p);
                const ms = [...p.markets].sort((a, b) => (accountOf(a.account_id)?.name ?? "").localeCompare(accountOf(b.account_id)?.name ?? ""));
                const linkedOnly = p.links.filter((l) => !p.markets.some((m) => m.account_id === l.account_id));
                const qty = p.markets.reduce((t, m) => t + (m.qty_in ?? 0), 0);
                return (
                  <tbody key={p.id} className="pf-group">
                    <tr className="pf-product">
                      <td>
                        <span className="strong">{p.name}</span>
                        <div className="sub">
                          {p.unit_cost === null ? <span className="pill" data-tone="warning">Falta el costo</span> : (
                            <>
                              {money(p.unit_cost, p.cost_currency)}
                              {p.import_cost ? <> + {money(p.import_cost, p.cost_currency)} importación</> : null}
                              {p.cost_currency === "GTQ" && p.fx_gtq_per_usd && <> · Q{p.fx_gtq_per_usd} por USD</>}
                            </>
                          )}
                          {p.links.length === 0 && <> · sin producto de Drop vinculado</>}
                        </div>
                      </td>
                      <td className="num strong">{usd(c.cost_total)}</td>
                      <td className="num">{p.pickup_cost === null ? <span className="subtle">—</span> : usd(c.pickup)}</td>
                      <td colSpan={4} />
                      <td className="num">{qty > 0 ? fmtInt(qty) : null}</td>
                      <td className="r nowrap">
                        <SideSheet trigger="Editar" triggerClass="btn btn-ghost btn-sm" title={p.name} sub="Ficha de costos">
                          {form(p)}
                          <div className="section im-recv-photos">
                            <DeleteProfitForm action={deleteProfitProduct} id={p.id} label={p.name} />
                          </div>
                        </SideSheet>
                      </td>
                    </tr>
                    {ms.map((m) => {
                      const a = accountOf(m.account_id);
                      if (!a) return null;
                      const e = marketEconomics(p, m, a.usd_rate);
                      const linked = p.links.some((l) => l.account_id === m.account_id);
                      return (
                        <tr key={m.account_id} className="pf-market-row">
                          <td>
                            <span className="pf-acc">{a.name}</span>
                            <div className="sub">
                              {carrierLabel(m.carrier) ?? (a.country === "GT" ? "Sin traslado" : "Transportista sin indicar")}
                              {!linked && <> · <span className="im-warn-text">sin producto de Drop</span></>}
                            </div>
                          </td>
                          <td />
                          <td />
                          <td className="num">{m.transfer_cost === null ? <span className="subtle">—</span> : usd(e.transfer)}</td>
                          <td className="num strong">{usd(e.landed === null ? null : e.landed + e.fulfillment)}</td>
                          <td className="num"><PriceCell price={m.price_community} p={e.community} currency={a.currency} /></td>
                          <td className="num"><PriceCell price={m.price_users} p={e.users} currency={a.currency} /></td>
                          <td className="num">
                            {m.qty_in === null ? <span className="subtle">—</span> : fmtInt(m.qty_in)}
                            {e.investment !== null && e.investment > 0 && <div className="sub">{usd(e.investment)} invertidos</div>}
                          </td>
                          <td />
                        </tr>
                      );
                    })}
                    {linkedOnly.map((l) => {
                      const a = accountOf(l.account_id);
                      return a ? (
                        <tr key={`l-${l.account_id}`} className="pf-market-row">
                          <td>
                            <span className="pf-acc">{a.name}</span>
                            <div className="sub">Vinculado, sin precios ni traslado</div>
                          </td>
                          <td />
                          <td />
                          <td className="num"><span className="subtle">—</span></td>
                          <td className="num strong">{usd(c.landed === null ? null : c.landed + FULFILLMENT_USD)}</td>
                          <td colSpan={4} />
                        </tr>
                      ) : null;
                    })}
                  </tbody>
                );
              })}
            </table>
          </div>
        )}
      </div>
      <p className="footnote">
        Costo total = costo + importación. Costo final = costo total + recolección en Guatemala + traslado al país + fulfillment
        ({usd(1.2)} por pedido, fijo). Rentabilidad = precio (comunidad o usuarios, en la moneda de la cuenta, pasado a dólares con el tipo
        de cambio de Drop) − costo final. Si los costos están en quetzales, se pasan a dólares con el tipo de cambio de la ficha. La
        cantidad ingresada × el costo sin fulfillment es lo invertido en ese inventario. En el Resumen, la utilidad real usa lo que Drop descontó de
        verdad en cada pedido entregado, que puede incluir una comisión además del fulfillment.
      </p>
    </div>
  );
}
