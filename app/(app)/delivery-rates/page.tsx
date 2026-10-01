import Link from "next/link";
import { AccountChips } from "@/components/account-chips";
import { DeliveryFilters } from "@/components/delivery-filters";
import { PageHead } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { requirePermission } from "@/lib/auth";
import { countryByCode } from "@/lib/countries";
import { deliveryStats } from "@/lib/delivery-data";
import { completedOrders, deliveryRate, totalDeliveryRate, openOrders } from "@/lib/delivery-rates";
import { fmtInt, todayIn } from "@/lib/format";
import { addDays, resolveRange } from "@/lib/ranges";
import { getScope } from "@/lib/scope";

export const metadata = { title: "Tasas de entrega" };
export const maxDuration = 60;
type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, key: string) => { const v = sp[key]; return Array.isArray(v) ? v[0] : v; };
const pct = (n: number | null) => n === null ? "—" : `${(100 * n).toLocaleString("es", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

export default async function DeliveryRatesPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("business");
  const [accounts, sp] = await Promise.all([listAccounts(), searchParams]);
  const scope = await getScope(accounts);
  const scoped = accounts.filter((a) => !scope.account || a.id === scope.account);
  const countries = [...new Set(scoped.map((a) => a.country))].sort().map((code) => ({ code, name: countryByCode(code)?.name ?? code }));
  const requested = one(sp, "country");
  const country = countries.some((c) => c.code === requested) ? requested! : "";
  const selected = scoped.filter((a) => !country || a.country === country);
  const tz = (country ? countryByCode(country)?.timezone : undefined) ?? scope.tz;
  const today = todayIn(tz);
  const preset = one(sp, "r");
  const range = resolveRange(["7", "30", "90"].includes(preset ?? "") ? preset : "30", tz,
    preset === "custom" ? { from: one(sp, "from"), to: one(sp, "to") } : undefined);
  const ageParam = one(sp, "age");
  const age = ageParam === "7" || ageParam === "14" ? Number(ageParam) : 0;
  // Exclude the last N complete local calendar days and the current day.
  const cutoffDay = addDays(today, -age - 1);
  const cutoff = age ? resolveRange("custom", tz, { from: cutoffDay, to: cutoffDay }).to : range.to;
  const to = cutoff < range.to ? cutoff : range.to;
  const includeCancelled = one(sp, "cancelled") === "1";
  const { rows, total } = await deliveryStats(selected, range.from, to);
  const completed = completedOrders(total, includeCancelled);
  const next = `/delivery-rates?${new URLSearchParams({ r: range.id, ...(range.days ?? {}), age: String(age), cancelled: includeCancelled ? "1" : "0" })}`;
  const dateLabel = (date: Date) => date.toLocaleDateString("es", { timeZone: tz, day: "numeric", month: "short", year: "numeric" });

  return <div className="page delivery-page">
    <PageHead title="Tasas de entrega" sub={`${scope.label}${country ? ` · ${countryByCode(country)?.name ?? country}` : ""} · ${range.short}`} />
    <AccountChips accounts={accounts} current={scope.account} next={next} />
    <DeliveryFilters key={JSON.stringify([country, range.id, range.days, age, includeCancelled, scope.account])}
      countries={countries} country={country} period={range.id} from={range.days?.from ?? ""} to={range.days?.to ?? ""}
      today={today} age={String(age)} includeCancelled={includeCancelled} />
    <p className="delivery-context">Pedidos creados del {dateLabel(range.from)} al {dateLabel(range.to)} · Zona: {tz}.
      {age > 0 && <> Se consideran solo los creados hasta el {dateLabel(cutoff)}.</>} Estados actuales según la última sincronización.</p>

    <section className="metrics" aria-label="Resumen de tasas de entrega">
      <div className="metric"><span className="label">Entregados sobre el total</span>
        <span className="value">{pct(totalDeliveryRate(total))}</span><span className="foot">{fmtInt(total.delivered)} entregados de {fmtInt(total.total)} pedidos</span></div>
      <div className="metric"><span className="label">Entregados entre completados{includeCancelled ? " + cancelados" : ""}</span>
        <span className="value">{pct(deliveryRate(total, includeCancelled))}</span><span className="foot">{fmtInt(total.delivered)} de {fmtInt(completed)} · {includeCancelled ? "Incluye cancelados y rechazados" : "Entregados + no entregados"}</span></div>
      <div className="metric"><span className="label">Todavía abiertos</span><span className="value">{fmtInt(openOrders(total))}</span>
        <span className="foot">{pct(total.total ? openOrders(total) / total.total : null)} del total · pendientes, en tránsito o en gestión</span></div>
      <div className="metric"><span className="label">Cancelados / rechazados</span><span className="value">{fmtInt(total.cancelled)}</span>
        <span className="foot">Siempre en el total · {includeCancelled ? "incluidos en completados" : "excluidos de completados"}</span></div>
    </section>

    <section className="panel" aria-labelledby="delivery-comparison-title">
      <div className="panel-head"><h2 id="delivery-comparison-title">Por transportadora y país</h2><span className="aside">{fmtInt(total.total)} pedidos · {fmtInt(rows.length)} grupos</span></div>
      {rows.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Comparación de transportadoras, tabla desplazable">
        <table className="table delivery-table">
          <caption className="sr-only">Entregados sobre todos los pedidos y entregados entre operaciones completadas. Cada tasa muestra su denominador.</caption>
          <thead><tr><th scope="col">Transportadora / país</th><th scope="col">Tasas de entrega</th><th scope="col" className="r">Base completados{includeCancelled ? " + cancelados" : ""}</th>
            <th scope="col" className="r">Entregados</th><th scope="col" className="r">No entregados</th><th scope="col" className="r">Cancelados</th><th scope="col" className="r">Abiertos</th><th scope="col" className="r">Sin clasificar</th></tr></thead>
          <tbody>{rows.map((row) => {
            const rate = deliveryRate(row, includeCancelled);
            const totalRate = totalDeliveryRate(row);
            const base = completedOrders(row, includeCancelled);
            return <tr key={JSON.stringify([row.country, row.carrier])}>
              <th scope="row"><span className="delivery-carrier">{row.carrier}</span><span className="delivery-country">{countryByCode(row.country)?.name ?? row.country}</span></th>
              <td><div className="delivery-rate-pair">
                <div><span className="delivery-rate-label">Sobre el total</span>
                  <div className="delivery-rate"><strong>{pct(totalRate)}</strong>{totalRate !== null && <meter min={0} max={1} value={totalRate} aria-label={`Entregados sobre el total de ${row.carrier} en ${row.country}`} />}</div>
                  <span className="delivery-sample">{fmtInt(row.delivered)} de {fmtInt(row.total)} pedidos</span></div>
                <div><span className="delivery-rate-label">Entre completados{includeCancelled ? " + cancelados" : ""}</span>
                  <div className="delivery-rate"><strong>{pct(rate)}</strong>{rate !== null && <meter min={0} max={1} value={rate} aria-label={`Entregados entre completados${includeCancelled ? " y cancelados" : ""} de ${row.carrier} en ${row.country}`} />}</div>
                  <span className="delivery-sample">{fmtInt(row.delivered)} de {fmtInt(base)} en la base</span>
                  {base < 30 && <span className="delivery-sample">{base === 0 ? "Sin operaciones en la base" : "Muestra pequeña · menos de 30"}</span>}</div>
              </div></td>
              <td className="num strong">{fmtInt(base)}</td><td className="num">{fmtInt(row.delivered)}</td><td className="num">{fmtInt(row.failed)}</td>
              <td className="num">{fmtInt(row.cancelled)}</td><td className="num" title={`${row.dispatch} por despachar · ${row.transit} en tránsito · ${row.problem} en gestión`}>{fmtInt(openOrders(row))}</td><td className="num">{fmtInt(row.unknown)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div> : <div className="empty"><h3>No hay pedidos para estos filtros</h3><p>Amplía las fechas o reduce la antigüedad mínima para ver las transportadoras.</p><Link className="btn" href="/delivery-rates">Restablecer filtros</Link></div>}
    </section>

    <section className="delivery-method" aria-labelledby="delivery-method-title">
      <h2 id="delivery-method-title">Cómo leer estos porcentajes</h2>
      <p><strong>Sobre el total: entregados ÷ todos los pedidos seleccionados × 100.</strong> Incluye en la base abiertos, cancelados, rechazados y sin clasificar. Muestra cuánto del total ya se entregó; lo restante no equivale a entregas fallidas.</p>
      <p><strong>Entre completados{includeCancelled ? " + cancelados" : ""}: entregados ÷ (entregados + no entregados{includeCancelled ? " + cancelados y rechazados" : ""}) × 100.</strong> Los pendientes, en tránsito, en gestión y sin clasificar quedan fuera de esta base. Por eso puede ser mucho mayor si todavía hay muchos pedidos abiertos. Sin pedidos en una base se muestra «—», no 0 %.</p>
      <p>El período corresponde a la creación del pedido, no al día de entrega. Los pedidos recientes pueden seguir abiertos; usa la antigüedad mínima para darles tiempo a resolverse. Las cancelaciones no siempre son responsabilidad de la transportadora.</p>
      <p>Compara dentro del mismo país y considera la mezcla de tiendas, productos y destinos. Una tasa alta con pocos pedidos no demuestra un mejor servicio. El total se calcula con todos los pedidos, sin promediar los porcentajes de las filas.</p>
      {total.unknown > 0 && <p>{fmtInt(total.unknown)} pedidos tienen un estado sin clasificar: se incluyen en el total y se excluyen de completados.</p>}
    </section>
  </div>;
}
