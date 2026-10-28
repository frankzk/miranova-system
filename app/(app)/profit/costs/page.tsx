import Link from "next/link";
import { IconPlus, IconSearch } from "@/components/icons";
import { DeleteProfitForm, ProfitForm } from "@/components/profit-forms";
import { ProfitSubnav } from "@/components/profit-subnav";
import { SideSheet } from "@/components/side-sheet";
import { PageHead } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { fmtInt, todayIn } from "@/lib/format";
import { can, permissionFlags } from "@/lib/permissions";
import { costProduct, type CostProduct } from "@/lib/profit-access";
import { defaultGtqRate } from "@/lib/lab-purchases-data";
import {
  automaticHnlFx, carrierLabel, costSymbol, costFx, FULFILLMENT_USD, normName, profitPeriod, unitCosts, windowStart,
  type Carrier, type MarketAccount, type ProfitProduct,
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
const money = (n: number | null, c: ProfitProduct["cost_currency"]) => (n === null ? null : `${costSymbol(c)}${n.toLocaleString("en-US", { maximumFractionDigits: 4 })}`);

export default async function ProfitCostsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [user, sp] = await Promise.all([requirePermission("product_costs"), searchParams]);
  const today = todayIn();
  const [accounts, products, fx, catalog] = await Promise.all([
    marketAccounts(),
    listProfitProducts().then((ps) => ps.map(costProduct)),
    defaultGtqRate().catch(() => 7.75),
    // Keep historical products available for linking. Only catalog names/keys reach the form.
    profitDelivered(windowStart(today, profitPeriod("mes", today)), "delivered").then(profitCatalog),
  ]);
  // Also retain older links outside the historical window so editing cannot silently clear them.
  const catalogKeys = new Set(catalog.map((c) => `${c.account_id}|${c.product_key}`));
  for (const p of products) for (const l of p.links) {
    const key = `${l.account_id}|${l.product_key}`;
    if (!catalogKeys.has(key)) { catalog.push({ ...l, name: p.name }); catalogKeys.add(key); }
  }
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
  const hnlFx = automaticHnlFx(accounts);
  const form = (v?: Partial<CostProduct>) => (
    <ProfitForm
      action={saveProfitProduct} v={v} accounts={accounts} catalog={catalog} taken={taken}
      carrierDefaults={carrierDefaults} defaultFx={fx} defaultHnlFx={hnlFx} names={names}
    />
  );

  const accountOf = (id: string): MarketAccount | undefined => accounts.find((a) => a.id === id);
  const missingCost = products.filter((p) => p.unit_cost === null).length;

  return (
    <div className="page pf-page">
      <PageHead
        title="Costos por producto"
        sub={<>
          {fmtInt(products.length)} {products.length === 1 ? "ficha" : "fichas"}
          {missingCost > 0 && <> · {fmtInt(missingCost)} sin costo</>}
          {" "}· costo, recolección y traslado por cuenta
        </>}
        actions={
          <SideSheet
            trigger={<><IconPlus /> Nueva ficha</>} triggerClass="btn btn-primary" hash="nueva"
            title="Nueva ficha de costos" sub="Costos del producto y, en cada cuenta, traslado y cantidad ingresada"
          >
            {form(seed ? { name: seed.name, links: [{ account_id: seed.account_id, product_key: seed.product_key }] } : undefined)}
          </SideSheet>
        }
      />
      <ProfitSubnav sheets={products.length} perms={permissionFlags(user)} />

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
                : "Crea una ficha por producto: costo, importación (si aplica), recolección en Guatemala y, por cuenta, el traslado. Los precios se cargan por separado en Precios comerciales."}
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
                              {p.cost_currency !== "USD" && costFx(p) && <> · {costSymbol(p.cost_currency)}{costFx(p)} por USD</>}
                            </>
                          )}
                          {p.links.length === 0 && <> · sin producto de Drop vinculado</>}
                        </div>
                      </td>
                      <td className="num strong">{usd(c.cost_total)}</td>
                      <td className="num">{p.pickup_cost === null ? <span className="subtle">—</span> : usd(c.pickup)}</td>
                      <td colSpan={2} />
                      <td className="num">{qty > 0 ? fmtInt(qty) : null}</td>
                      <td className="r nowrap">
                        <SideSheet trigger="Editar" triggerClass="btn btn-ghost btn-sm" title={p.name} sub="Ficha de costos">
                          {form(p)}
                          <div className="section im-recv-photos">
                            {can(user, "product_prices") && <DeleteProfitForm action={deleteProfitProduct} id={p.id} label={p.name} />}
                          </div>
                        </SideSheet>
                      </td>
                    </tr>
                    {ms.map((m) => {
                      const a = accountOf(m.account_id);
                      if (!a) return null;
                      const e = unitCosts(p, m);
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
                          <td className="num strong">{usd(e.landed === null ? null : e.landed + FULFILLMENT_USD)}</td>
                          <td className="num">
                            {m.qty_in === null ? <span className="subtle">—</span> : fmtInt(m.qty_in)}
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
                            <div className="sub">Vinculado, sin traslado</div>
                          </td>
                          <td />
                          <td />
                          <td className="num"><span className="subtle">—</span></td>
                          <td className="num strong">{usd(c.landed === null ? null : c.landed + FULFILLMENT_USD)}</td>
                          <td colSpan={2} />
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
        ({usd(1.2)} por pedido, fijo). Los costos en lempiras usan automáticamente el tipo de cambio actual sincronizado de Drop, también en Rentabilidad y Excel. Los costos en quetzales usan la tasa de la ficha. Todos los costos de una ficha usan la moneda seleccionada.
      </p>
    </div>
  );
}
