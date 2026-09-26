import Link from "next/link";
import { BarChart } from "@/components/bar-chart";
import { IconArrowRight, IconChevronRight, IconPlus } from "@/components/icons";
import { PageHead, place, StatusPill } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { fmtInt, fmtLongDay, fmtMoney, fmtShort } from "@/lib/format";
import { attentionOrders, dashboardSummary, type RankRow } from "@/lib/queries";
import { getScope } from "@/lib/scope";
import { RANGES, resolveRange } from "@/lib/ranges";

export const metadata = { title: "Inicio" };

export default async function Home({ searchParams }: { searchParams: Promise<{ r?: string; days?: string }> }) {
  const accounts = await listAccounts();
  const scope = await getScope(accounts);

  if (accounts.length === 0) return <Welcome />;

  const sp = await searchParams;
  const range = resolveRange(sp.r ?? sp.days, scope.tz);
  const [s, attention] = await Promise.all([
    dashboardSummary({ account: scope.account, from: range.from, to: range.to, tz: scope.tz, bucket: range.bucket }),
    attentionOrders(scope.account),
  ]);

  const snap = s.snapshot;
  const periodOrders = s.daily.reduce((t, d) => t + d.orders, 0);
  const periodDelivered = s.daily.reduce((t, d) => t + d.delivered, 0);
  const multi = s.money.length > 1 || s.unpaid.length > 1;

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
          </nav>
        }
      />

      <section className="metrics" aria-label="Resumen">
        <Link className="metric" href="/orders?group=dispatch">
          <span className="label"><span className="dot" data-tone="warning" aria-hidden />Por despachar</span>
          <span className="value">{fmtInt(snap.dispatch ?? 0)}</span>
          <span className="foot">Pendientes o con guía creada<IconArrowRight className="go" /></span>
        </Link>
        <Link className="metric" href="/orders?group=problem" data-alert={(snap.problem ?? 0) > 0}>
          <span className="label"><span className="dot" data-tone="danger" aria-hidden />Con problemas</span>
          <span className="value">{fmtInt(snap.problem ?? 0)}</span>
          <span className="foot">Por verificar o en gestión<IconArrowRight className="go" /></span>
        </Link>
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

      <div className="grid-2">
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
                recibidas {range.bucket === "hour" ? range.short : `en ${range.short}`} · {fmtInt(periodDelivered)} ya entregadas
              </span>
            </div>
            <BarChart days={s.daily} bucket={range.bucket} />
          </div>
        </section>

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
      </div>

      <div className="grid-3">
        <Ranking
          title="Dropshippers"
          rows={s.sellers}
          href={(r) => `/orders?dropshipper=${encodeURIComponent(r.name)}`}
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
          href={(r) => `/orders?carrier=${encodeURIComponent(r.name)}`}
          meta={(r) => `${pct(r.delivered ?? 0, r.orders)} entregadas · ${pct(r.problems ?? 0, r.orders)} con problemas`}
          split
        />
      </div>
    </div>
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

function Welcome() {
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
