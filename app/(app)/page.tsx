import Link from "next/link";
import { AccountChips } from "@/components/account-chips";
import { ActiveStores } from "@/components/active-stores";
import { BarChart } from "@/components/bar-chart";
import { OrderGrowth } from "@/components/order-growth";
import { OwnerAlertsPanel } from "@/components/owner-alerts";
import { IconArrowRight, IconChevronRight, IconPlus } from "@/components/icons";
import { PageHead, place, StatusPill } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { requireUser } from "@/lib/auth";
import { fmtInt, fmtLongDay, fmtMoney, fmtShort, todayIn } from "@/lib/format";
import { attentionOrders, dashboardSummary, ownerAlerts, type RankRow } from "@/lib/queries";
import { activeStores, orderGrowth } from "@/lib/overview";
import { getScope } from "@/lib/scope";
import { can } from "@/lib/permissions";
import { RangePicker } from "@/components/range-picker";
import { RANGES, rangeQuery, resolveRange } from "@/lib/ranges";

export const metadata = { title: "Inicio" };

export default async function Home({ searchParams }: { searchParams: Promise<{ r?: string; days?: string; from?: string; to?: string }> }) {
  // Inicio es para todos los usuarios; cada bloque se muestra según sus permisos
  const [user, accounts] = await Promise.all([requireUser(), listAccounts()]);
  const canOrders = can(user, "orders");
  const canMoney = can(user, "money");
  const scope = await getScope(accounts);

  if (accounts.length === 0) return <Welcome canConnect={can(user, "accounts")} />;

  const sp = await searchParams;
  const range = resolveRange(sp.r ?? sp.days, scope.tz, { from: sp.from, to: sp.to });
  const rq = rangeQuery(range);
  const here = rq ? `/?${rq}` : "/";
  const [s, attention, alerts, overview, growth] = await Promise.all([
    dashboardSummary({ account: scope.account, from: range.from, to: range.to, tz: scope.tz, bucket: range.bucket }),
    // órdenes con problemas: datos del cliente, solo con permiso de Órdenes
    canOrders ? attentionOrders(scope.account) : null,
    ownerAlerts(scope.account),
    activeStores(scope.account),
    // crecimiento semanal y mensual: si falla, Inicio se muestra igual sin ese bloque
    orderGrowth(scope.account).catch((e) => {
      console.error("order_growth", e);
      return null;
    }),
  ]);

  const snap = s.snapshot;
  const periodOrders = s.daily.reduce((t, d) => t + d.orders, 0);
  const periodDelivered = s.daily.reduce((t, d) => t + d.delivered, 0);
  const multi = s.money.length > 1 || (canMoney && s.unpaid.length > 1);
  const go = canOrders ? <IconArrowRight className="go" /> : null;

  return (
    <div className="page">
      <PageHead
        title="Inicio"
        sub={<>{capitalize(fmtLongDay(new Date(), scope.tz))} · {scope.label}</>}
        actions={
          <nav className="segmented" aria-label="Período">
            {RANGES.map((r) => (
              <Link key={r.id} href={r.id === "30" ? "/" : `/?r=${r.id}`} aria-current={r.id === range.id}>
                {r.label}
              </Link>
            ))}
            <RangePicker range={range} today={todayIn(scope.tz)} path="/" />
          </nav>
        }
      />

      <AccountChips accounts={accounts} current={scope.account} next={here} />

      <OwnerAlertsPanel data={alerts} tz={scope.tz} access={{ money: canMoney, orders: canOrders, products: can(user, "products") }} />

      <section className="metrics" aria-label="Resumen">
        <Metric href={canOrders ? "/orders?group=dispatch" : undefined}>
          <span className="label"><span className="dot" data-tone="warning" aria-hidden />Por despachar</span>
          <span className="value">{fmtInt(snap.dispatch ?? 0)}</span>
          <span className="foot">Pendientes o con guía creada{go}</span>
        </Metric>
        <Metric href={canOrders ? "/orders?group=problem" : undefined} alert={(snap.problem ?? 0) > 0}>
          <span className="label"><span className="dot" data-tone="danger" aria-hidden />Con problemas</span>
          <span className="value">{fmtInt(snap.problem ?? 0)}</span>
          <span className="foot">Por verificar o en gestión{go}</span>
        </Metric>
        {/* liquidaciones: solo con permiso de Dinero; si no, lo entregado en el período */}
        {canMoney ? (
          <Link className="metric" href="/money">
            <span className="label"><span className="dot" data-tone="success" aria-hidden />Por liquidar</span>
            {s.unpaid.length === 0 ? (
              <span className="value">{fmtMoney(0, scope.current?.currency ?? "HNL")}</span>
            ) : (
              s.unpaid.map((u) => (
                <span key={u.currency} className={`value${multi ? " sm" : ""}`}>{fmtMoney(u.amount, u.currency)}</span>
              ))
            )}
            <span className="foot">
              {fmtInt(s.unpaid.reduce((t, u) => t + u.orders, 0))} entregadas sin pagar<IconArrowRight className="go" />
            </span>
          </Link>
        ) : (
          <div className="metric">
            <span className="label"><span className="dot" data-tone="success" aria-hidden />Entregadas · {range.short}</span>
            <span className="value">{fmtInt(periodDelivered)}</span>
            <span className="foot">de {fmtInt(periodOrders)} recibidas</span>
          </div>
        )}
        <div className="metric">
          <span className="label">Ventas · {range.short}</span>
          {s.money.length === 0 ? (
            <span className="value">{fmtMoney(0, scope.current?.currency ?? "HNL")}</span>
          ) : (
            s.money.map((m) => (
              <span key={m.currency} className={`value${multi ? " sm" : ""}`}>{fmtMoney(m.sales, m.currency, { compact: true, always: true })}</span>
            ))
          )}
          <span className="foot">
            Te toca {s.money.map((m) => fmtMoney(m.vendor_delivered, m.currency, { compact: true, always: true })).join(" + ") || "—"} de lo entregado
          </span>
        </div>
      </section>

      <ActiveStores o={overview} showAccount={!scope.account && accounts.length > 1} tz={scope.tz} linkStores={can(user, "stores")} />

      {/* sin "Requieren atención" el gráfico ocupa todo el ancho */}
      <div className="grid-2" style={attention ? undefined : { gridTemplateColumns: "minmax(0, 1fr)" }}>
        <section className="panel">
          <div className="panel-head">
            <h2>Órdenes</h2>
            <div className="chart-legend" aria-hidden>
              <span><i style={{ background: "var(--accent)" }} />Entregadas</span>
              <span><i style={{ background: "#cdcaff" }} />Recibidas</span>
            </div>
          </div>
          <div className="panel-body">
            <div className="chart-total">
              <strong>{fmtInt(periodOrders)}</strong>
              <span className="muted">
                recibidas {range.during} · {fmtInt(periodDelivered)} ya entregadas
              </span>
            </div>
            <BarChart days={s.daily} bucket={range.bucket} />
            {growth && <OrderGrowth g={growth} linkStores={can(user, "stores")} showAccount={!scope.account && accounts.length > 1} />}
          </div>
        </section>

        {attention && (
          <section className="panel">
            <div className="panel-head">
              <h2>Requieren atención</h2>
              <span className="aside">{fmtInt(attention.count)}</span>
            </div>
            {attention.orders.length === 0 ? (
              <div className="empty" style={{ padding: "36px 18px" }}>
                <h3>Todo en orden</h3>
                <p>No hay órdenes por verificar ni con problemas en gestión.</p>
              </div>
            ) : (
              <>
                <ul className="list-rows panel-flush">
                  {attention.orders.map((o) => (
                    <li key={o.id}>
                      <Link href={`/orders?group=problem&order=${o.id}`}>
                        <span className="t">#{o.external_id}</span>
                        <StatusPill code={o.status_code} label={o.status} />
                        <span className="s">
                          {o.customer_name ?? "Sin nombre"} · {place(o.city, o.department) || "Sin ciudad"}
                        </span>
                        <span className="s" style={{ textAlign: "right" }}>{fmtShort(o.ordered_at, o.accounts?.timezone)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="panel-foot">
                  <Link className="btn btn-ghost btn-sm" href="/orders?group=problem">
                    Ver las {fmtInt(attention.count)} <IconChevronRight />
                  </Link>
                </div>
              </>
            )}
          </section>
        )}
      </div>

      <div className="grid-3">
        <Ranking
          title="Dropshippers"
          rows={s.sellers}
          href={canOrders ? (r) => `/orders?dropshipper=${encodeURIComponent(r.name)}` : undefined}
          meta={(r) => `${fmtInt(r.delivered ?? 0)} entregadas · ${fmtInt(r.problems ?? 0)} con problemas`}
          split
        />
        <Ranking
          title="Productos más pedidos"
          rows={s.products.map((p) => ({ ...p, orders: p.units ?? p.orders }))}
          meta={(r) => `${fmtInt(r.orders)} unidades`}
          unit="u."
        />
        <Ranking
          title="Paqueteras"
          rows={s.carriers}
          href={canOrders ? (r) => `/orders?carrier=${encodeURIComponent(r.name)}` : undefined}
          meta={(r) => `${pct(r.delivered ?? 0, r.orders)} entregadas · ${pct(r.problems ?? 0, r.orders)} con problemas`}
          split
        />
      </div>
    </div>
  );
}

/** Métrica de la franja: enlace si hay destino permitido; si no, solo texto. */
function Metric({ href, alert, children }: { href?: string; alert?: boolean; children: React.ReactNode }) {
  return href ? (
    <Link className="metric" href={href} data-alert={alert}>{children}</Link>
  ) : (
    <div className="metric" data-alert={alert}>{children}</div>
  );
}

function Ranking({
  title,
  rows,
  meta,
  href,
  split,
  unit,
}: {
  title: string;
  rows: RankRow[];
  meta: (r: RankRow) => string;
  href?: (r: RankRow) => string;
  split?: boolean;
  unit?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.orders));
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="panel-body muted">Sin datos en este período.</p>
      ) : (
        <ul className="rank panel-flush">
          {rows.map((r) => {
            const w = (r.orders / max) * 100;
            const ok = split ? ((r.delivered ?? 0) / max) * 100 : 0;
            const bad = split ? ((r.problems ?? 0) / max) * 100 : 0;
            const name = href ? <Link className="name link" href={href(r)} style={{ color: "inherit", fontWeight: 500 }}>{r.name}</Link> : <span className="name" title={r.name}>{r.name}</span>;
            return (
              <li key={r.name}>
                {name}
                <span className="n">{fmtInt(r.orders)}{unit ? ` ${unit}` : ""}</span>
                <span className="bar" aria-hidden>
                  {split ? (
                    <>
                      <i className="ok" style={{ width: `${ok}%` }} />
                      <i className="bad" style={{ width: `${bad}%` }} />
                      <i className="rest" style={{ width: `${Math.max(0, w - ok - bad)}%` }} />
                    </>
                  ) : (
                    <i className="units" style={{ width: `${w}%` }} />
                  )}
                </span>
                <span className="meta">{meta(r)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Welcome({ canConnect }: { canConnect: boolean }) {
  // conectar cuentas es de quien tiene permiso de Cuentas; los demás solo ven el aviso
  if (!canConnect)
    return (
      <div className="page page-narrow">
        <PageHead title="Bienvenido a Miranova" sub="Todavía no hay datos para mostrar." />
        <section className="panel">
          <div className="empty">
            <h3>Aún no hay cuentas conectadas</h3>
            <p>Cuando el dueño conecte una cuenta de Drop, aquí verás el resumen de las órdenes.</p>
          </div>
        </section>
      </div>
    );
  return (
    <div className="page page-narrow">
      <PageHead title="Bienvenido a Miranova" sub="Conecta tu primera cuenta para empezar a ver tus órdenes." />
      <section className="panel">
        <div className="empty">
          <h3>Aún no hay cuentas conectadas</h3>
          <p>
            Agrega tu cuenta de Drop con su correo y contraseña. Las órdenes se sincronizan solas cada 10 minutos,
            con su historial, estados y lo que te toca como proveedor.
          </p>
          <Link className="btn btn-primary" href="/settings#nueva">
            <IconPlus /> Conectar una cuenta
          </Link>
        </div>
      </section>
    </div>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pct = (a: number, b: number) => `${b ? Math.round((a / b) * 100) : 0}%`;
