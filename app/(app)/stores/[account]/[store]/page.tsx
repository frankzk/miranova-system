import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { IconArrowRight, IconChevronRight } from "@/components/icons";
import { StoreChart } from "@/components/store-chart";
import { StoreContactBar } from "@/components/store-contact";
import { StoreFollowups } from "@/components/store-followups";
import { PageHead } from "@/components/ui";
import { storeContactView } from "@/lib/contacts";
import { fmtInt, fmtMoney, fmtShort } from "@/lib/format";
import { storeDetail } from "@/lib/store-detail";
import { fmtDay, pctChange, vsAverage, type StoreDetail } from "@/lib/store-metrics";
import { classify, HEALTH, opportunities, type StoreRow } from "@/lib/stores";
import { addFollowup, updateFollowup } from "./actions";
import { linkStore, saveContact, unlinkStore } from "./contact-actions";
import "./store-detail.css";

type Params = Promise<{ account: string; store: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Una sola consulta por petición aunque la pidan el título y la página. */
const load = cache(async (account: string, store: string) => {
  const accountId = decode(account);
  const storeId = decode(store);
  if (!UUID.test(accountId) || !storeId) return null;
  return storeDetail(accountId, storeId);
});

const loadContact = cache(async (account: string, store: string) => {
  const accountId = decode(account);
  const storeId = decode(store);
  if (!UUID.test(accountId) || !storeId) return null;
  return storeContactView(accountId, storeId);
});

export async function generateMetadata({ params }: { params: Params }) {
  const { account, store } = await params;
  const d = await load(account, store);
  return { title: d?.store.name ?? "Tienda" };
}

export default async function StorePage({ params }: { params: Params }) {
  const { account, store } = await params;
  const [d, contact] = await Promise.all([load(account, store), loadContact(account, store)]);
  if (!d || !contact) notFound();

  const { store: s, kpis: k, benchmark: b } = d;
  const money = (n: number | null | undefined) => fmtMoney(n, s.currency);
  const row = asRow(d);
  const health = classify(row);
  // mismas alertas que en Oportunidades; el ticket se compara con el promedio de las tiendas de la cuenta
  const ops = opportunities(row, d.benchmark?.ticket ?? null, (n) => fmtMoney(n, s.currency, { compact: true }));
  const perDay = k.d7 / 7;
  const change = pctChange(k.d7, k.prev7);
  const top = d.products[0];
  const ordersHref = `/orders?dropshipper=${encodeURIComponent(s.name)}`;

  return (
    <div className="page store-detail">
      <PageHead
        crumbs={<><Link href="/stores">Salud de tiendas</Link><IconChevronRight aria-hidden /><span>{s.account_name}</span></>}
        title={s.name}
        sub={
          <>
            <span className="pill" data-tone={HEALTH[health].tone} title={HEALTH[health].hint}>{HEALTH[health].label}</span>{" "}
            {lastSale(k.days_since)} · {s.account_name} · {s.currency}
            {k.first_at && <> · primera venta registrada {fmtDay(k.first_at.slice(0, 10), s.today)}</>}
          </>
        }
        actions={<Link className="btn" href={ordersHref}>Ver pedidos <IconArrowRight /></Link>}
      />

      <StoreContactBar
        view={contact}
        store={{ accountId: s.account_id, storeId: s.store_id, storeName: s.name }}
        actions={{ save: saveContact, link: linkStore, unlink: unlinkStore }}
      />

      {ops.length > 0 && (
        <section className="panel sd-ops" aria-labelledby="sd-ops-title">
          <div className="panel-head"><h2 id="sd-ops-title">Qué hacer con esta tienda</h2><span className="aside">{ops.length} {ops.length === 1 ? "oportunidad" : "oportunidades"}</span></div>
          <ul className="sd-ops-list panel-flush">
            {ops.map((o) => (
              <li key={o.kind} data-priority={o.priority}>
                <span className="t">{o.text}</span>
                <span className="a"><b>Acción:</b> {o.action}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 className="sd-title">Ventas</h2>
      <section className="metrics" aria-label="Ventas">
        <Metric label="Pedidos hoy" value={fmtInt(k.today)} foot="Día local de la cuenta" />
        <Metric label="Últimos 7 días" value={fmtInt(k.d7)} foot={<>{fmtInt(k.prev7)} los 7 anteriores</>} />
        <Metric label="Últimos 30 días" value={fmtInt(k.n30)} foot={`${(k.n30 / 30).toFixed(1)} por día`} />
        <Metric
          label="Promedio por día (7 días)"
          value={perDay.toFixed(1)}
          foot={change === null
            ? <span className="subtle">{k.d7 > 0 ? "Sin ventas la semana anterior" : "Sin ventas"}</span>
            : <><Delta c={change} /> vs. 7 días anteriores</>}
        />
      </section>

      <h2 className="sd-title">Rentabilidad comercial <span>últimos 30 días</span></h2>
      <section className="metrics" aria-label="Rentabilidad comercial">
        <Metric label="Ticket promedio" value={money(k.ticket)} small foot="Venta por pedido" />
        <Metric label="Unidades por pedido" value={k.units_per_order?.toFixed(2) ?? "—"} foot="Productos promedio" />
        <Metric label="Venta total" value={fmtMoney(k.sales30, s.currency, { compact: true })} small foot={`${fmtInt(k.n30)} pedidos`} />
        <Metric label="Te toca por pedido" value={money(k.vendor_per_order)} small foot={<>{fmtMoney(k.vendor30, s.currency, { compact: true })} en total</>} />
      </section>

      <section className="panel sd-chart" aria-labelledby="sd-chart-title">
        <div className="panel-head"><h2 id="sd-chart-title">Evolución diaria</h2><span className="aside">Sin canceladas ni rechazadas</span></div>
        <div className="panel-body"><StoreChart daily={d.daily} currency={s.currency} /></div>
      </section>

      <div className="grid-2 sd-grid">
        <section className="panel" aria-labelledby="sd-products">
          <div className="panel-head">
            <h2 id="sd-products">Productos</h2>
            <span className="aside">{d.products.length} en 30 días</span>
          </div>
          {top && top.share !== null && (
            <p className="sd-lead">
              <b>{Math.round(top.share * 100)}%</b> de sus pedidos llevan <b>{top.name}</b>
              {d.products.length === 1 ? " (su único producto)." : "."}
            </p>
          )}
          {d.products.length === 0 ? (
            <p className="panel-body muted">Sin pedidos en los últimos 30 días.</p>
          ) : (
            <ul className="rank panel-flush">
              {d.products.map((p) => (
                <li key={p.product_key}>
                  <span className="name" title={p.name}>{p.name}</span>
                  <span className="n">{p.share === null ? "—" : `${Math.round(p.share * 100)}%`}</span>
                  <span className="bar"><i className="units" style={{ width: `${Math.min(100, (p.share ?? 0) * 100)}%` }} /></span>
                  <span className="meta">
                    {fmtInt(p.orders)} pedidos · {fmtInt(p.units)} unid.{p.sales !== null && <> · {fmtMoney(p.sales, s.currency, { compact: true })}</>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="sd-side">
          <section className="panel" aria-labelledby="sd-activity">
            <div className="panel-head"><h2 id="sd-activity">Actividad</h2></div>
            <dl className="sd-kv panel-body">
              <div>
                <dt>Días con ventas (7 días)</dt>
                <dd>
                  <span className="constancy">
                    <span className="bars" aria-hidden>{Array.from({ length: 7 }, (_, i) => <i key={i} data-on={i < k.active7 || undefined} />)}</span>
                    {k.active7}/7
                  </span>
                </dd>
              </div>
              <div><dt>Última venta</dt><dd>{k.last_at ? fmtShort(k.last_at, s.timezone) : "—"}</dd></div>
              <div>
                <dt>Mejor día (30 días)</dt>
                <dd>{d.activity.best30 ? <>{fmtDay(d.activity.best30.day, s.today)} · {fmtInt(d.activity.best30.orders)} pedidos</> : "—"}</dd>
              </div>
              <div>
                <dt>Récord en un día</dt>
                <dd>{d.activity.record ? <>{fmtInt(d.activity.record.orders)} pedidos · {fmtDay(d.activity.record.day, s.today)}</> : "—"}</dd>
              </div>
            </dl>
          </section>

          {b && b.stores > 1 && (
            <section className="panel" aria-labelledby="sd-bench">
              <div className="panel-head">
                <h2 id="sd-bench">Frente a las demás tiendas</h2>
                <span className="aside">Interno</span>
              </div>
              <div className="panel-body">
                <p className="sd-note">
                  {k.n30 > 0 && <>Puesto <b>#{b.rank_d7}</b> de {fmtInt(b.stores)} por pedidos en 7 días. </>}
                  Promedio de las tiendas con pedidos en 30 días en {s.account_name}.
                </p>
                <ul className="sd-bench">
                  <Bench label="Pedidos/día" value={perDay} avg={b.orders_per_day} fmt={(n) => n.toFixed(1)} />
                  <Bench label="Ticket" value={k.ticket} avg={b.ticket} fmt={(n) => money(n)} />
                  <Bench label="Unidades/pedido" value={k.units_per_order} avg={b.units_per_order} fmt={(n) => n.toFixed(2)} />
                </ul>
              </div>
            </section>
          )}
        </div>
      </div>

      <StoreFollowups
        accountId={s.account_id}
        storeId={s.store_id}
        storeName={s.name}
        currency={s.currency}
        daily={d.daily}
        today={s.today}
        actions={{ add: addFollowup, update: updateFollowup }}
      />

      <p className="footnote">
        Sin pedidos cancelados ni rechazados. &ldquo;7 días&rdquo; son las últimas 168 horas (igual que en Salud de tiendas); los días
        de la gráfica y la actividad son días calendario de {s.timezone}. El porcentaje de cada producto es sobre los pedidos de la tienda
        (un pedido puede llevar varios productos).
      </p>
    </div>
  );
}

/** Adapta la ficha a una fila de Salud de tiendas para usar el mismo semáforo. */
function asRow({ store: s, kpis: k, daily, products }: StoreDetail): StoreRow {
  return {
    account_id: s.account_id, store_id: s.store_id, account_name: s.account_name, currency: s.currency, name: s.name,
    today: k.today, d7: k.d7, prev7: k.prev7, active7: k.active7, active_prev7: k.active_prev7, last_at: k.last_at,
    days_since: k.days_since, n30: k.n30, ticket: k.ticket, vendor_per_order: k.vendor_per_order, units_per_order: k.units_per_order,
    delivered30: k.delivered30, failed30: k.failed30, daily: daily.slice(-14).map((x) => x.orders),
    sales30: k.sales30, skus30: products.length, top_product: products[0]?.name ?? null, top_share: products[0]?.share ?? null,
  };
}

function lastSale(d: number | null) {
  if (d === null) return "Sin ventas";
  if (d === 0) return "Última venta hoy";
  if (d === 1) return "Última venta ayer";
  return `Sin vender hace ${d} días`;
}

function Metric({ label, value, foot, small }: { label: string; value: React.ReactNode; foot?: React.ReactNode; small?: boolean }) {
  return (
    <div className="metric">
      <span className="label">{label}</span>
      <span className={`value${small ? " sm" : ""}`}>{value}</span>
      {foot && <span className="foot">{foot}</span>}
    </div>
  );
}

function Delta({ c }: { c: number }) {
  const pct = Math.round(c * 100);
  const tone = pct > 15 ? "up" : pct < -15 ? "down" : "flat";
  return <span className="delta" data-tone={tone}>{pct > 0 ? "↑" : pct < 0 ? "↓" : ""} {Math.abs(pct)}%</span>;
}

function Bench({ label, value, avg, fmt }: { label: string; value: number | null; avg: number | null; fmt: (n: number) => string }) {
  const v = vsAverage(value, avg);
  const max = Math.max(value ?? 0, avg ?? 0) || 1;
  return (
    <li>
      <div className="row">
        <span className="t">{label}</span>
        <b className="v">{value === null ? "—" : fmt(value)}</b>
      </div>
      <div className="bars" aria-hidden>
        <i className="me" style={{ width: `${((value ?? 0) / max) * 100}%` }} />
        <i className="avg" style={{ width: `${((avg ?? 0) / max) * 100}%` }} />
      </div>
      <div className="row foot">
        <span className="muted">Promedio {avg === null ? "—" : fmt(avg)}</span>
        {v && <span className="delta" data-tone={v.tone}>{v.text}</span>}
      </div>
    </li>
  );
}
