import Link from "next/link";
import { RowLink } from "@/components/client";
import { PageHead, StatusPill } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { fmtInt, fmtMoney, fmtShort } from "@/lib/format";
import { dashboardSummary, moneyByMonth, unpaidDelivered, type MonthRow } from "@/lib/queries";
import { getScope } from "@/lib/scope";
import { resolveRange } from "@/lib/ranges";

export const metadata = { title: "Dinero" };

const MONTHS = 6;
const CURRENCY_NAME: Record<string, string> = { HNL: "Lempiras", GTQ: "Quetzales", USD: "Dólares", NIO: "Córdobas", CRC: "Colones", DOP: "Pesos dominicanos", MXN: "Pesos mexicanos", COP: "Pesos colombianos", PEN: "Soles", CLP: "Pesos chilenos", EUR: "Euros" };

export default async function MoneyPage() {
  const accounts = await listAccounts();
  const scope = await getScope(accounts);
  const [months, summary, unpaid] = await Promise.all([
    moneyByMonth({ account: scope.account, months: MONTHS, tz: scope.tz }),
    dashboardSummary({ account: scope.account, ...resolveRange("30", scope.tz), tz: scope.tz }),
    unpaidDelivered(scope.account, 15),
  ]);

  const currencies = [...new Set([...summary.unpaid.map((u) => u.currency), ...months.map((m) => m.currency)])];
  const bands = currencies.length ? currencies : [scope.current?.currency ?? "HNL"];
  const showAccount = !scope.account && accounts.length > 1;

  return (
    <div className="page">
      <PageHead title="Dinero" sub={<>Lo que vendes, lo que te toca y lo que falta por liquidar · {scope.label}</>} />

      {bands.map((cur) => {
        const u = summary.unpaid.find((x) => x.currency === cur);
        const m = summary.money.find((x) => x.currency === cur);
        const who = [...new Set(months.filter((r) => r.currency === cur).map((r) => r.account_name).filter(Boolean))].join(", ");
        return (
          <div key={cur}>
          {bands.length > 1 && (
            <h2 className="band-label">{CURRENCY_NAME[cur] ?? cur} · {cur}{who && <span>{who}</span>}</h2>
          )}
          <section className="metrics" aria-label={`Resumen en ${CURRENCY_NAME[cur] ?? cur}`}>
            <div className="metric">
              <span className="label"><span className="dot" data-tone="success" aria-hidden />Por liquidar</span>
              <span className="value">{fmtMoney(u?.amount ?? 0, cur)}</span>
              <span className="foot">{fmtInt(u?.orders ?? 0)} órdenes entregadas sin pagar</span>
            </div>
            <div className="metric">
              <span className="label">Liquidado · 30 días</span>
              <span className="value">{fmtMoney(m?.vendor_paid ?? 0, cur)}</span>
              <span className="foot">De órdenes creadas en los últimos 30 días</span>
            </div>
            <div className="metric">
              <span className="label">En camino · 30 días</span>
              <span className="value">{fmtMoney(m?.vendor_in_flight ?? 0, cur)}</span>
              <span className="foot">Te tocará al entregarse lo despachado</span>
            </div>
            <div className="metric">
              <span className="label">Ganancia neta · 30 días</span>
              <span className="value">{fmtMoney(m?.vendor_net ?? 0, cur)}</span>
              <span className="foot">Estimada por la plataforma, de lo entregado</span>
            </div>
          </section>
          </div>
        );
      })}

      <section className="table-wrap" style={{ marginBottom: 20 }}>
        <div className="panel-head" style={{ paddingBottom: 12 }}>
          <h2>Por mes</h2>
          <span className="aside">Últimos {MONTHS} meses, según la fecha de creación de la orden</span>
        </div>
        {months.length === 0 ? (
          <p className="panel-body muted">Sin órdenes en este período.</p>
        ) : (
          <>
          <ul className="month-list only-sm">
            {months.map((r) => (
              <li key={`${r.month}-${r.account_name}-${r.currency}`}>
                <div className="top">{monthLabel(r.month)}<span>{showAccount ? r.account_name : `${fmtInt(r.orders)} órdenes`}</span></div>
                <dl>
                  <div><dt>Ventas</dt><dd>{fmtMoney(r.sales, r.currency)}</dd></div>
                  <div><dt>Te toca</dt><dd>{fmtMoney(r.vendor_delivered, r.currency)}</dd></div>
                  <div><dt>Liquidado</dt><dd>{fmtMoney(r.vendor_paid, r.currency)}</dd></div>
                  <div><dt>Por liquidar</dt><dd>{fmtMoney(r.vendor_unpaid, r.currency)}</dd></div>
                  <div><dt>Entregadas</dt><dd>{fmtInt(r.delivered)}</dd></div>
                  <div><dt>Problemas</dt><dd>{fmtInt(r.problems)}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
          <div className="table-scroll not-sm">
            <table className="table">
              <thead>
                <tr>
                  <th>Mes</th>
                  {showAccount && <th>Cuenta</th>}
                  <th className="r">Órdenes</th>
                  <th className="r">Entregadas</th>
                  <th className="r hide-md">Problemas</th>
                  <th className="r">Ventas</th>
                  <th className="r">Te toca</th>
                  <th className="r">Liquidado</th>
                  <th className="r">Por liquidar</th>
                  <th className="r hide-lg">Ganancia neta</th>
                </tr>
              </thead>
              <tbody>
                {months.map((r) => <MonthLine key={`${r.month}-${r.account_name}-${r.currency}`} r={r} showAccount={showAccount} />)}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>

      <section className="table-wrap">
        <div className="panel-head" style={{ paddingBottom: 12 }}>
          <h2>Entregadas sin liquidar</h2>
          <span className="aside">{fmtInt(unpaid.count)} órdenes · las más antiguas primero</span>
        </div>
        {unpaid.orders.length === 0 ? (
          <div className="empty" style={{ padding: "32px 18px" }}>
            <h3>Todo liquidado</h3>
            <p>No hay órdenes entregadas pendientes de pago.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table stack">
              <thead>
                <tr>
                  <th>Orden</th>
                  <th>Cliente</th>
                  <th className="hide-md">Dropshipper</th>
                  <th>Estado</th>
                  <th className="r">Te toca</th>
                  <th className="hide-lg">Creada</th>
                </tr>
              </thead>
              <tbody>
                {unpaid.orders.map((o) => (
                  <RowLink key={o.id} href={`/orders?group=delivered&order=${o.id}`}>
                    <td data-slot="id"><Link className="order-no" href={`/orders?group=delivered&order=${o.id}`}>#{o.external_id}</Link></td>
                    <td data-slot="customer"><div className="clip">{o.customer_name ?? "—"}</div></td>
                    <td className="hide-md hide-sm">{o.dropshipper ?? "—"}</td>
                    <td data-slot="status"><StatusPill code={o.status_code} label={o.status} /></td>
                    <td data-slot="total" className="num strong">{fmtMoney(o.vendor_amount, o.currency ?? "HNL")}</td>
                    <td data-slot="date" className="hide-lg muted nowrap">{fmtShort(o.ordered_at, o.accounts?.timezone)}</td>
                  </RowLink>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function MonthLine({ r, showAccount }: { r: MonthRow; showAccount: boolean }) {
  const label = monthLabel(r.month);
  const c = r.currency;
  return (
    <tr>
      <td className="strong nowrap">{label}</td>
      {showAccount && <td className="nowrap">{r.account_name ?? "—"}</td>}
      <td className="num">{fmtInt(r.orders)}</td>
      <td className="num">{fmtInt(r.delivered)}</td>
      <td className="num hide-md">{fmtInt(r.problems)}</td>
      <td className="num">{fmtMoney(r.sales, c)}</td>
      <td className="num strong">{fmtMoney(r.vendor_delivered, c)}</td>
      <td className="num">{fmtMoney(r.vendor_paid, c)}</td>
      <td className="num" style={{ color: r.vendor_unpaid > 0 ? "var(--warning)" : undefined }}>{fmtMoney(r.vendor_unpaid, c)}</td>
      <td className="num hide-lg">{fmtMoney(r.vendor_net, c)}</td>
    </tr>
  );
}

function monthLabel(month: string) {
  const raw = new Intl.DateTimeFormat("es-HN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}T00:00:00Z`));
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
