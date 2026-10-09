import Link from "next/link";
import { monthLong, monthShort, visibleMonths } from "@/lib/active-months";
import { fmtInt, fmtMoney, fmtShort } from "@/lib/format";
import type { Overview, OverviewStore } from "@/lib/overview";
import { storeHref } from "@/lib/store-links";

/**
 * Resumen Miranova: cuántas tiendas realmente mueven pedidos (embudo 30 d → 7 d → hoy/ayer),
 * cómo cambia la base (nuevas, reactivadas, dejaron de vender) y cuánto vende cada tienda activa.
 * No depende del período elegido en Inicio: siempre mira las ventanas fijas.
 */
export function ActiveStores({ o, showAccount, tz, linkStores }: {
  o: Overview; showAccount: boolean; tz: string;
  /** con permiso de Tiendas el nombre enlaza a la ficha; sin él, solo texto */
  linkStores: boolean;
}) {
  const s = o.stores;
  const funnel = [
    { label: "Registradas", n: s.registered, hint: "Alguna vez hicieron un pedido" },
    { label: "Vendieron en 30 días", n: s.active30 },
    { label: "Vendieron en 7 días", n: s.active7 },
    { label: "Vendieron hoy o ayer", n: s.active2d },
  ];
  const max = Math.max(1, s.registered);
  const perStore7 = s.active7 ? o.orders_7d / s.active7 : 0;
  const prevWeek = o.weeks.find((w) => w.k === 1);
  const perStorePrev = prevWeek?.active ? prevWeek.orders / prevWeek.active : null;
  const perStoreDelta = perStorePrev ? Math.round(((perStore7 - perStorePrev) / perStorePrev) * 100) : null;
  const list = (kind: OverviewStore["kind"]) => o.lists.filter((x) => x.kind === kind);

  return (
    <section className="panel active-stores" aria-labelledby="active-stores-title">
      <div className="panel-head">
        <h2 id="active-stores-title">Tiendas activas</h2>
        <span className="aside">Cuántas tiendas realmente mueven pedidos · no depende del período</span>
      </div>
      <div className="panel-body as-grid">
        <div>
          <ul className="as-funnel">
            {funnel.map((f) => (
              <li key={f.label} title={f.hint}>
                <span className="l">{f.label}</span>
                <span className="n">{fmtInt(f.n)}</span>
                <span className="p">{f.label === "Registradas" ? "" : `${Math.round((f.n / max) * 100)}%`}</span>
                <span className="bar" aria-hidden><i style={{ width: `${(f.n / max) * 100}%` }} /></span>
              </li>
            ))}
          </ul>
          <dl className="as-kpis">
            <div>
              <dt>Pedidos por tienda activa</dt>
              <dd>
                {perStore7.toFixed(1)} <small>en 7 días · {(perStore7 / 7).toFixed(1)}/día</small>
                {perStoreDelta !== null && (
                  <span className="delta" data-tone={perStoreDelta > 15 ? "up" : perStoreDelta < -15 ? "down" : "flat"}>
                    {perStoreDelta > 0 ? "↑" : perStoreDelta < 0 ? "↓" : ""} {Math.abs(perStoreDelta)}% vs. semana anterior
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt>Unidades por pedido</dt>
              <dd>{o.units_per_order?.toFixed(2) ?? "—"} <small>30 días</small></dd>
            </div>
            <div>
              <dt>Ticket promedio</dt>
              <dd>
                {o.tickets.length === 0 ? "—" : o.tickets.map((t) => (
                  <span key={t.currency} className="tk">{fmtMoney(t.ticket, t.currency)}</span>
                ))}
                <small>30 días</small>
              </dd>
            </div>
          </dl>
        </div>

        <div className="as-changes">
          <Change kind="new" title="Nuevas este mes" hint="Su primer pedido fue este mes" items={list("new")} n={s.new_month} link={linkStores} showAccount={showAccount} tz={tz} tone="success" />
          <Change kind="reactivated" title="Reactivadas" hint="Volvieron a pedir en 30 días tras 30+ días sin pedidos" items={list("reactivated")} n={s.reactivated} link={linkStores} showAccount={showAccount} tz={tz} tone="info" />
          <Change kind="stopped" title="Dejaron de vender" hint="Pedían (3+ pedidos) y llevan 14 días sin pedidos" items={list("stopped")} n={s.stopped} link={linkStores} showAccount={showAccount} tz={tz} tone="danger" />
          <Weeks weeks={o.weeks} />
          <Months months={o.months} />
        </div>
      </div>
    </section>
  );
}

function Change({ kind, title, hint, items, n, link, showAccount, tz, tone }: {
  kind: OverviewStore["kind"]; title: string; hint: string; items: OverviewStore[]; n: number; link: boolean; showAccount: boolean; tz: string; tone: string;
}) {
  const head = (
    <>
      <span className="dot" data-tone={tone} aria-hidden />
      <span className="t">{title}</span>
      <span className="n">{fmtInt(n)}</span>
    </>
  );
  if (items.length === 0) return <div className="as-change" title={hint}><div className="sum">{head}</div></div>;
  return (
    <details className="as-change" title={hint}>
      <summary className="sum">{head}</summary>
      <ul>
        {items.slice(0, 12).map((x) => (
          <li key={`${x.account_id}:${x.store_id}`}>
            {link ? <Link href={storeHref(x.account_id, x.store_id)}>{x.name}</Link> : <span style={{ fontWeight: 550 }}>{x.name}</span>}
            <span className="muted">
              {kind === "stopped" ? `${fmtInt(x.orders)} pedidos antes · último ${fmtShort(x.at, tz)}` : `${fmtInt(x.orders)} pedidos en 30 días`}
              {showAccount && ` · ${x.account_name}`}
            </span>
          </li>
        ))}
        {items.length > 12 && <li className="muted">y {fmtInt(items.length - 12)} más</li>}
      </ul>
    </details>
  );
}

/** Tiendas activas por semana (12 semanas móviles); la parte oscura son las que vendieron por primera vez. */
function Weeks({ weeks }: { weeks: Overview["weeks"] }) {
  const max = Math.max(1, ...weeks.map((w) => w.active));
  return (
    <figure className="as-weeks">
      <figcaption>Tiendas activas por semana <span className="muted">· oscuro = nuevas</span></figcaption>
      <div className="cols" role="img" aria-label={`Tiendas activas por semana: ${weeks.map((w) => w.active).join(", ")}`}>
        {weeks.map((w) => (
          <span key={w.k} className="col" title={`${w.k === 0 ? "Últimos 7 días" : `Hace ${w.k} semana${w.k > 1 ? "s" : ""}`}: ${w.active} activas, ${w.new} nuevas, ${w.orders} pedidos`}>
            <i className="all" style={{ height: `${(w.active / max) * 100}%` }}>
              <i className="new" style={{ height: `${w.active ? (Math.min(w.new, w.active) / w.active) * 100 : 0}%` }} />
            </i>
          </span>
        ))}
      </div>
      <div className="ends muted"><span>hace 12 sem.</span><span>esta semana</span></div>
    </figure>
  );
}

/**
 * Tiendas activas por mes calendario, con la misma idea que por semana: la barra son las tiendas
 * con al menos un pedido en el mes y la parte oscura, las que hicieron su primer pedido ese mes.
 */
function Months({ months }: { months: Overview["months"] }) {
  const list = visibleMonths(months);
  if (list.length === 0) return null;
  const max = Math.max(1, ...list.map((m) => m.active));
  const current = list.at(-1)!.month;
  const detail = (m: (typeof list)[number]) =>
    `${monthLong(m.month)}${m.k === 0 ? " (en curso)" : ""}: ${fmtInt(m.active)} activas, ${fmtInt(m.new)} nuevas, ${fmtInt(m.orders)} pedidos`;
  return (
    <figure className="as-weeks as-months">
      <figcaption>Tiendas activas por mes <span className="muted">· oscuro y +N = nuevas</span></figcaption>
      <div className="cols" style={{ gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))` }} role="img" aria-label={`Tiendas activas por mes: ${list.map(detail).join("; ")}`}>
        {list.map((m) => (
          <span key={m.month} className="col" title={detail(m)}>
            <span className="bar" style={{ height: `${(m.active / max) * 100}%` }}>
              <span className="v">{fmtInt(m.active)}</span>
              <i className="all">
                <i className="new" style={{ height: `${m.active ? (Math.min(m.new, m.active) / m.active) * 100 : 0}%` }} />
              </i>
            </span>
          </span>
        ))}
      </div>
      <div className="labels muted" style={{ gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))` }} aria-hidden>
        {list.map((m) => (
          <span key={m.month}>
            {monthShort(m.month, current)}
            {m.new > 0 && <small>+{fmtInt(m.new)}</small>}
          </span>
        ))}
      </div>
    </figure>
  );
}
