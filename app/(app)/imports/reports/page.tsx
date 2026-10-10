import Link from "next/link";
import { redirect } from "next/navigation";
import { ImportsSubnav } from "@/components/imports-subnav";
import { MonthBars } from "@/components/month-bars";
import { PageHead } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { countryByCode } from "@/lib/countries";
import { fmtInt, fmtMoney, todayIn } from "@/lib/format";
import { lastMonths, monthlySpend, moneyInTransit, supplierStats, unitCostHistory } from "@/lib/import-reports";
import { listSuppliers, reportData } from "@/lib/imports-data";
import { can } from "@/lib/permissions";
import "../imports.css";

export const metadata = { title: "Reportes de importaciones" };

const usd = (n: number) => fmtMoney(n, "USD");
const pct = (x: number) => `${Math.round(x * 100)} %`;
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("es-HN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const monthLabel = (m: string) => new Intl.DateTimeFormat("es-HN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T12:00:00Z`));

export default async function ImportReportsPage() {
  const user = await requirePermission("imports");
  if (!can(user, "money")) redirect("/sin-acceso?p=money");
  const [data, suppliers] = await Promise.all([reportData(), listSuppliers()]);
  const today = todayIn();
  const transit = moneyInTransit(data.imports, data.items, data.costs, data.payments);
  const months = monthlySpend(data.imports, data.items, data.costs, data.payments, lastMonths(today, 12));
  const year = months.reduce((t, m) => t + m.bought, 0);
  const history = unitCostHistory(data.imports, data.items, data.costs);
  const stats = supplierStats(data.imports, data.items, data.costs);
  const ranked = suppliers.map((s) => ({ s, st: stats.get(s.id) })).filter((x) => x.st && x.st.bought > 0).sort((a, b) => b.st!.spent - a.st!.spent);

  return (
    <div className="page im-page">
      <PageHead title="Reportes de importaciones" sub="Dinero en camino, gasto por mes, cómo cambia el costo por unidad y cómo rinde cada proveedor · USD" />
      <ImportsSubnav money />

      <section className="metrics" aria-label="Resumen">
        <div className="metric">
          <span className="label">Dinero en camino</span>
          <span className="value">{usd(transit.total)}</span>
          <span className="foot">{fmtInt(transit.count)} {transit.count === 1 ? "importación" : "importaciones"} · {fmtInt(transit.units)} u. sin llegar</span>
        </div>
        <div className="metric">
          <span className="label">Pagado de lo que viene</span>
          <span className="value">{usd(transit.paid)}</span>
          <span className="foot">{transit.due > 0.005 ? `Falta pagar ${usd(transit.due)}` : transit.total > 0 ? "Todo pagado" : "Nada en camino"}</span>
        </div>
        <div className="metric">
          <span className="label">Comprado en 12 meses</span>
          <span className="value">{usd(year)}</span>
          <span className="foot">{fmtInt(months.reduce((t, m) => t + m.imports, 0))} importaciones pedidas</span>
        </div>
        <div className="metric">
          <span className="label">Este mes</span>
          <span className="value">{usd(months[months.length - 1].bought)}</span>
          <span className="foot">Pagado este mes {usd(months[months.length - 1].paid)}</span>
        </div>
      </section>

      <div className="im-two">
        <section className="panel" aria-labelledby="rp-month">
          <div className="panel-head"><h2 id="rp-month">Comprado por mes</h2><span className="aside">Según el mes del pedido</span></div>
          <div className="panel-body">
            <MonthBars label="Comprado por mes, últimos 12 meses" months={months.map((m) => ({ month: m.month, value: m.bought, detail: `${m.imports} ${m.imports === 1 ? "importación" : "importaciones"} · pagado ${usd(m.paid)}` }))} />
          </div>
        </section>
        <section className="panel" aria-labelledby="rp-transit">
          <div className="panel-head"><h2 id="rp-transit">En camino por país</h2><span className="aside">Pagadas que no han llegado</span></div>
          <div className="panel-body">
            {transit.byCountry.length === 0 ? (
              <p className="muted im-small">No hay importaciones en camino.</p>
            ) : (
              <ul className="im-list">
                {transit.byCountry.map((c) => (
                  <li key={c.country}>
                    <span className="grow">{countryByCode(c.country)?.name ?? c.country}<span className="sub"> · {c.count} {c.count === 1 ? "importación" : "importaciones"}</span></span>
                    <span className="num strong">{usd(c.total)}</span>
                  </li>
                ))}
              </ul>
            )}
            <table className="table im-months">
              <thead><tr><th>Mes</th><th className="r">Comprado</th><th className="r">Pagado</th></tr></thead>
              <tbody>
                {[...months].reverse().filter((m) => m.bought > 0 || m.paid > 0).slice(0, 6).map((m) => (
                  <tr key={m.month}><td>{monthLabel(m.month)}</td><td className="num">{usd(m.bought)}</td><td className="num">{usd(m.paid)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="table-wrap im-section" aria-labelledby="rp-unit">
        <div className="panel-head"><h2 id="rp-unit">Costo por unidad de cada producto</h2><span className="aside">Costo final por unidad buena, en cada importación</span></div>
        {history.length === 0 ? (
          <p className="panel-body muted">Todavía no hay importaciones compradas con productos.</p>
        ) : (
          <div className="table-scroll">
            <table className="table im-history">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="r">Último costo</th>
                  <th className="r">Anterior</th>
                  <th className="r">Cambio</th>
                  <th>Historial</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.key}>
                    <td>
                      <div className="strong">{h.name}</div>
                      <div className="sub">{h.sku ? `SKU ${h.sku}` : "Sin SKU"} · {h.points.length} {h.points.length === 1 ? "importación" : "importaciones"}</div>
                    </td>
                    <td className="num strong">{usd(h.last.unit)}<div className="sub"><Link href={`/imports/${h.last.import_id}`}>{h.last.code}</Link> · {day(h.last.day)}</div></td>
                    <td className="num">{h.prev ? <>{usd(h.prev.unit)}<div className="sub">{h.prev.code}</div></> : <span className="subtle">—</span>}</td>
                    <td className="num">
                      {h.change === null ? <span className="subtle">—</span> : (
                        <span className={h.change > 0.02 ? "im-alert-text" : h.change < -0.02 ? "im-ok-text" : undefined}>{h.change > 0 ? "+" : ""}{pct(h.change)}</span>
                      )}
                    </td>
                    <td>
                      {h.points.length > 1 ? (
                        <details className="im-hist">
                          <summary>Ver {h.points.length}</summary>
                          <ul>
                            {h.points.map((p) => (
                              <li key={p.import_id}>
                                <Link href={`/imports/${p.import_id}`}>{p.code}</Link> · {day(p.day)}{p.supplier && <> · {p.supplier}</>} · {fmtInt(p.good)} u. · <b>{usd(p.unit)}</b>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : <span className="subtle">Una sola</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="table-wrap im-section" aria-labelledby="rp-sup">
        <div className="panel-head"><h2 id="rp-sup">Proveedores</h2><span className="aside"><Link href="/imports/suppliers">Ver directorio</Link></span></div>
        {ranked.length === 0 ? (
          <p className="panel-body muted">Elige el proveedor en cada importación para comparar cuánto compras, cuánto tardan y cómo llega la mercadería.</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Proveedor</th>
                  <th className="r">Importaciones</th>
                  <th className="r">Comprado</th>
                  <th className="r">Tarda</th>
                  <th className="r">A tiempo</th>
                  <th className="r">Faltantes y dañadas</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map(({ s, st }) => (
                  <tr key={s.id}>
                    <td><div className="strong">{s.name}</div><div className="sub">{s.origin ?? "—"}</div></td>
                    <td className="num">{fmtInt(st!.bought)}</td>
                    <td className="num strong">{usd(st!.spent)}</td>
                    <td className="num">{st!.leadDays != null ? `${Math.round(st!.leadDays)} días` : <span className="subtle">—</span>}</td>
                    <td className="num">{st!.onTime != null ? pct(st!.onTime) : <span className="subtle">—</span>}</td>
                    <td className="num">{st!.lossRate != null ? <span className={st!.lossRate >= 0.03 ? "im-alert-text" : undefined}>{pct(st!.lossRate)}</span> : <span className="subtle">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="footnote">
        No cuentan las cotizaciones ni las canceladas. El costo por unidad incluye envío, importación y adicionales, repartidos como se
        indicó en cada importación, y se calcula sobre las unidades buenas cuando ya se contó la recepción.
      </p>
    </div>
  );
}
