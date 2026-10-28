import Link from "next/link";
import { AccountChips } from "@/components/account-chips";
import { IconDownload, IconPlus } from "@/components/icons";
import { ProfitBars, type ProfitBar } from "@/components/profit-bars";
import { LinkProfitForm } from "@/components/profit-forms";
import { ProfitSubnav } from "@/components/profit-subnav";
import { RangePicker } from "@/components/range-picker";
import { PageHead } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { requirePermission } from "@/lib/auth";
import { fmtInt, todayIn } from "@/lib/format";
import { can, permissionFlags } from "@/lib/permissions";
import {
  addDays, capitalize, coverage, dailyTotals, dayBuckets, dayLabel, margin, monthBuckets, monthLabel, monthProjection, monthShortLabel,
  pctChange, PROFIT_RANGES, profitPeriod, realize, spanLabel, weekBuckets, weekdayLabel, windowStart, type Acc, type Period,
} from "@/lib/profit";
import { listProfitProducts, marketAccounts, profitDelivered, ratesOf } from "@/lib/profit-data";
import type { Range } from "@/lib/ranges";
import { getScope } from "@/lib/scope";
import { linkToProfitProduct } from "./actions";
import "../imports/imports.css";
import "./profit.css";

export const metadata = { title: "Rentabilidad" };

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};

const usd = (n: number, digits = 2) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const usd0 = (n: number) => usd(n, Math.abs(n) >= 1000 ? 0 : 2);
const pctText = (p: number | null) => (p === null ? "—" : `${Math.round(p * 100)}%`);

function Delta({ change, title }: { change: number | null; title?: string }) {
  if (change === null) return null;
  const p = Math.round(change * 100);
  return (
    <span className="delta" data-tone={p >= 1 ? "up" : p <= -1 ? "down" : "flat"} title={title}>
      {p > 0 ? "↑" : p < 0 ? "↓" : ""} {Math.abs(p)}%
    </span>
  );
}

/** Líneas del detalle de una barra: utilidad, margen, lo cobrado y pedidos. */
const tipLines = (a: Acc) => [
  `Utilidad ${usd(a.profit)}${margin(a) === null ? "" : ` · margen ${pctText(margin(a))}`}`,
  `Cobrado ${usd(a.revenue)} · ${fmtInt(a.orders)} pedidos · ${fmtInt(a.units)} u.`,
  ...(a.revenue - a.covered_revenue > 0.005 ? [`Sin costo cargado: ${usd(a.revenue - a.covered_revenue)}`] : []),
];

export default async function ProfitPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [user, accounts, sp] = await Promise.all([requirePermission("profit"), listAccounts(), searchParams]);
  const scope = await getScope(accounts);
  const today = todayIn(scope.tz);
  const period = profitPeriod(one(sp, "r"), today, { from: one(sp, "from"), to: one(sp, "to") });
  const byOrder = one(sp, "b") === "pedido";
  const [markets, products, data] = await Promise.all([
    marketAccounts(),
    listProfitProducts(),
    profitDelivered(windowStart(today, period), byOrder ? "ordered" : "delivered"),
  ]);
  const rates = ratesOf(markets);
  const filter = { from: period.from, to: period.to, account: scope.account };
  const cur = realize(data, products, rates, filter);
  const prev = realize(data, products, rates, { ...filter, from: period.prev.from, to: period.prev.to });
  const daily = dailyTotals(data, products, rates, scope.account);
  const t = cur.totals;
  const cov = coverage(t);
  const accountName = (id: string) => markets.find((a) => a.id === id)?.name ?? accounts.find((a) => a.id === id)?.name ?? "Cuenta";
  const showAccount = !scope.account && markets.length > 1;

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | undefined> = {
      r: period.id === "custom" ? undefined : period.id === "mes" ? undefined : period.id,
      from: period.id === "custom" ? period.from : undefined,
      to: period.id === "custom" ? period.to : undefined,
      b: byOrder ? "pedido" : undefined,
    };
    for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/profit?${s}` : "/profit";
  };
  const here = qs({});
  const pickerRange = {
    id: period.id === "custom" ? "custom" : "30", label: period.label, short: period.label, during: period.label,
    from: new Date(), to: new Date(), bucket: "day", days: period.id === "custom" ? { from: period.from, to: period.to } : undefined,
  } as Range;
  const prevProduct = new Map(prev.products.map((p) => [p.id, p]));
  const sheetsList = products.map((p) => ({ id: p.id, name: p.name }));
  const exportHref = `/api/export/profit?${new URLSearchParams({ from: period.from, to: period.to, ...(byOrder ? { b: "pedido" } : {}) })}`;

  return (
    <div className="page pf-page">
      <PageHead
        title="Rentabilidad"
        sub={<>Utilidad real de lo entregado, en dólares · {scope.label}</>}
        actions={
          <>
            {can(user, "export") && (
              <a className="btn" href={exportHref} download title="Descargar en Excel (.xlsx) el período elegido: por producto, por cuenta y por día">
                <IconDownload /> Descargar Excel
              </a>
            )}
            {can(user, "product_costs") && <Link className="btn btn-primary" href="/profit/costs#nueva"><IconPlus /> Nueva ficha de costos</Link>}
          </>
        }
      />
      <ProfitSubnav sheets={products.length} perms={permissionFlags(user)} />
      <AccountChips accounts={markets} current={scope.account} next={here} />

      <div className="pf-toolbar">
        <nav className="segmented" aria-label="Período">
          {PROFIT_RANGES.map((r) => (
            <Link key={r.id} href={qs({ r: r.id === "mes" ? undefined : r.id, from: undefined, to: undefined })} aria-current={r.id === period.id}>
              {r.label}
            </Link>
          ))}
          <RangePicker range={pickerRange} today={today} path="/profit" keep={byOrder ? [["b", "pedido"]] : undefined} clearHref={qs({ from: undefined, to: undefined })} />
        </nav>
        <nav className="segmented" aria-label="Fecha que cuenta">
          <Link href={qs({ b: undefined })} aria-current={!byOrder} title="Cada pedido cuenta el día en que se entregó: así se ve lo que vas ganando día a día">
            Por fecha de entrega
          </Link>
          <Link href={qs({ b: "pedido" })} aria-current={byOrder} title="Cada pedido entregado cuenta el día en que se creó, como el Excel de pedidos del mes de Drop">
            Por fecha del pedido
          </Link>
        </nav>
      </div>

      {products.length === 0 && (
        <div className="banner" data-tone="info">
          <span>
            <b>Empieza por la ficha de costos de cada producto.</b> Los pedidos entregados ya llegan solos de Drop (cada 10 minutos, con su
            estado): en cuanto un producto tiene su costo, su utilidad aparece aquí. {can(user, "product_costs") && <Link href="/profit/costs#nueva">Crear la primera ficha</Link>}
          </span>
        </div>
      )}

      <p className="pf-period">
        <b>{period.label}</b> · {spanLabel(period.from, period.to)} · {byOrder ? "pedidos creados en el período y ya entregados" : "entregados en el período"}
      </p>

      <section className="metrics pf-metrics" aria-label="Resumen del período">
        <div className="metric">
          <span className="label"><span className="dot" data-tone={t.profit < 0 ? "danger" : "success"} aria-hidden />Utilidad</span>
          <span className="value" data-tone={t.profit < 0 ? "down" : undefined}>{usd(t.profit)}</span>
          <span className="foot">
            <span><Delta change={pctChange(t.profit, prev.totals.profit)} /> vs. {usd0(prev.totals.profit)} {period.prev.label}</span>
          </span>
        </div>
        <div className="metric">
          <span className="label">Margen</span>
          <span className="value">{pctText(margin(t))}</span>
          <span className="foot">
            Utilidad sobre lo cobrado{margin(prev.totals) !== null && <> · antes {pctText(margin(prev.totals))}</>}
          </span>
        </div>
        <div className="metric">
          <span className="label">Cobrado a Drop</span>
          <span className="value">{usd(t.revenue)}</span>
          <span className="foot">{fmtInt(t.orders)} pedidos entregados · {fmtInt(t.units)} unidades</span>
        </div>
        <div className="metric">
          <span className="label">Costos</span>
          <span className="value">{usd(t.cost + t.covered_fees)}</span>
          <span className="foot">Producto puesto {usd0(t.cost)} · Drop descontó {usd0(t.covered_fees)}</span>
        </div>
      </section>

      {t.revenue > 0 && cov !== null && cov < 0.995 && (
        <p className="pf-cover" data-tone={cov < 0.5 ? "warning" : undefined}>
          La utilidad cuenta solo lo que tiene costo cargado: <b>{usd0(t.covered_revenue)}</b> de {usd0(t.revenue)} cobrados ({pctText(cov)}).
          {cur.unlinked.length > 0 && <> Faltan <a href="#sin-ficha">{fmtInt(cur.unlinked.length)} productos sin ficha</a>.</>}
          {cur.products.some((p) => !p.has_cost) && <> Hay fichas sin costo.</>}
        </p>
      )}

      <PeriodChart period={period} daily={daily} today={today} />

      <Comparisons daily={daily} today={today} />

      <section className="table-wrap pf-block" aria-labelledby="pf-products">
        <div className="panel-head">
          <h2 id="pf-products">Por producto</h2>
          <span className="aside">{period.label} · comparado con {period.prev.name}</span>
        </div>
        {cur.products.length === 0 ? (
          <div className="empty">
            <h3>{products.length ? "Sin entregas de productos con ficha en el período" : "Aún no hay fichas de costos"}</h3>
            <p>
              {products.length
                ? "Elige otro período o vincula los productos entregados a su ficha (abajo)."
                : "Crea la ficha de cada producto con su costo, recolección, traslado y precios: aquí verás cuánto deja cada uno."}
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table pf-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="r">Unidades</th>
                  <th className="r">Cobrado</th>
                  <th className="r">Drop descontó</th>
                  <th className="r">Costo puesto</th>
                  <th className="r">Utilidad</th>
                  <th className="r">Margen</th>
                  <th className="r">Por unidad</th>
                </tr>
              </thead>
              <tbody>
                {cur.products.map((p) => {
                  const before = prevProduct.get(p.id);
                  return (
                    <tr key={p.id}>
                      <td>
                        {can(user, "product_costs") ? <Link className="strong pf-name" href={`/profit/costs?q=${encodeURIComponent(p.name)}`}>{p.name}</Link> : <span className="strong">{p.name}</span>}
                        <div className="sub">
                          {showAccount && <span>{p.accounts.map(accountName).join(" · ")}</span>}
                          {!p.has_cost && <span className="pill" data-tone="warning">Falta el costo</span>}
                        </div>
                      </td>
                      <td className="num">
                        {fmtInt(p.units)}
                        {p.community_units + p.users_units > 0 && (
                          <div className="sub">{fmtInt(p.community_units)} com. · {fmtInt(p.users_units)} us.</div>
                        )}
                      </td>
                      <td className="num">{usd(p.revenue)}</td>
                      <td className="num">{usd(p.fees)}</td>
                      <td className="num">{p.has_cost ? usd(p.cost) : <span className="subtle">—</span>}</td>
                      <td className="num">
                        {p.has_cost ? <b data-tone={p.profit < 0 ? "down" : undefined}>{usd(p.profit)}</b> : <span className="subtle">—</span>}
                        {p.has_cost && before?.has_cost && (
                          <div className="sub"><Delta change={pctChange(p.profit, before.profit)} title={`Antes: ${usd(before.profit)}`} /> vs. {usd0(before.profit)}</div>
                        )}
                      </td>
                      <td className="num">{p.has_cost ? pctText(margin(p)) : <span className="subtle">—</span>}</td>
                      <td className="num">{p.has_cost && p.covered_units > 0 ? usd(p.profit / p.covered_units) : <span className="subtle">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
              {cur.products.length > 1 && (
                <tfoot>
                  <tr>
                    <td>Total con ficha</td>
                    <td className="num">{fmtInt(cur.products.reduce((s, p) => s + p.units, 0))}</td>
                    <td className="num">{usd(cur.products.reduce((s, p) => s + p.revenue, 0))}</td>
                    <td className="num">{usd(cur.products.reduce((s, p) => s + p.fees, 0))}</td>
                    <td className="num">{usd(t.cost)}</td>
                    <td className="num">{usd(t.profit)}</td>
                    <td className="num">{pctText(margin(t))}</td>
                    <td className="num">{t.covered_units > 0 ? usd(t.profit / t.covered_units) : "—"}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </section>

      {showAccount && cur.accounts.length > 0 && (
        <section className="table-wrap pf-block" aria-labelledby="pf-accounts">
          <div className="panel-head">
            <h2 id="pf-accounts">Por cuenta</h2>
            <span className="aside">{period.label}</span>
          </div>
          <div className="table-scroll">
            <table className="table pf-table">
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th className="r">Pedidos</th>
                  <th className="r">Unidades</th>
                  <th className="r">Cobrado</th>
                  <th className="r">Utilidad</th>
                  <th className="r">Margen</th>
                  <th className="r">Con costo</th>
                </tr>
              </thead>
              <tbody>
                {cur.accounts.map((a) => (
                  <tr key={a.account_id}>
                    <td className="strong">{accountName(a.account_id)}</td>
                    <td className="num">{fmtInt(a.orders)}</td>
                    <td className="num">{fmtInt(a.units)}</td>
                    <td className="num">{usd(a.revenue)}</td>
                    <td className="num"><b data-tone={a.profit < 0 ? "down" : undefined}>{usd(a.profit)}</b></td>
                    <td className="num">{pctText(margin(a))}</td>
                    <td className="num">{pctText(coverage(a))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {cur.unlinked.length > 0 && (
        <section className="table-wrap pf-block" aria-labelledby="sin-ficha" id="sin-ficha">
          <div className="panel-head">
            <h2 id="pf-unlinked">Entregados sin ficha</h2>
            <span className="aside">{fmtInt(cur.unlinked.length)} productos · {usd0(cur.unlinked.reduce((s, u) => s + u.revenue, 0))} cobrados sin costo</span>
          </div>
          <p className="pf-help">
            Crea su ficha, o si es un producto que ya tiene ficha (otro país u otro nombre en Drop), vincúlalo para que use sus costos.
          </p>
          <div className="table-scroll">
            <table className="table pf-table pf-unlinked">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="r">Unidades</th>
                  <th className="r">Cobrado</th>
                  <th><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {cur.unlinked.slice(0, 40).map((u) => (
                  <tr key={`${u.account_id}|${u.key}`}>
                    <td>
                      <div className="strong">{u.name}</div>
                      <div className="sub">{accountName(u.account_id)}</div>
                    </td>
                    <td className="num">{fmtInt(u.units)}</td>
                    <td className="num">{usd(u.revenue)}</td>
                    <td className="pf-actions-cell">
                      {can(user, "product_costs") && <div className="pf-actions">
                        <LinkProfitForm action={linkToProfitProduct} accountId={u.account_id} productKey={u.key} products={sheetsList} />
                        <Link className="btn btn-sm" href={`/profit/costs?nuevo=${encodeURIComponent(`${u.account_id}|${u.key}`)}#nueva`}>Crear ficha</Link>
                      </div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cur.unlinked.length > 40 && <p className="pf-help">Y {fmtInt(cur.unlinked.length - 40)} más con menos ventas.</p>}
        </section>
      )}

      <p className="footnote">
        Utilidad = lo cobrado a Drop por cada unidad entregada − lo que Drop descontó en ese pedido (fulfillment de {usd(1.2)} y, cuando la
        hay, su comisión) − el costo puesto en el país de la ficha (costo + importación + recolección en Guatemala + traslado). Los montos
        en lempiras, quetzales o colones se pasan a dólares con el tipo de cambio de Drop. Las unidades de comunidad o usuarios salen del
        precio cobrado comparado con los dos precios de la ficha. Se actualiza con cada sincronización.
      </p>
    </div>
  );
}

/** Utilidad por día del período (o de los últimos 14 días si el período es un solo día). */
function PeriodChart({ period, daily, today }: { period: Period; daily: Map<string, Acc>; today: string }) {
  const single = period.from === period.to;
  const from = single ? addDays(period.to, -13) : period.from;
  const days = dayBuckets(daily, from, period.to);
  if (days.length > 120 || days.every((d) => d.acc.revenue === 0)) return null;
  const every = days.length > 45 ? 7 : days.length > 20 ? 4 : days.length > 10 ? 2 : 1;
  const bars: ProfitBar[] = days.map((d, i) => ({
    key: d.key,
    label: (days.length - 1 - i) % every === 0 ? dayLabel(d.key) : "",
    value: d.acc.profit,
    title: `${capitalize(weekdayLabel(d.key))} ${dayLabel(d.key)}${d.key === today ? " (hoy, en curso)" : ""}`,
    lines: tipLines(d.acc),
    current: d.key === today || (single && d.key === period.to),
  }));
  return (
    <section className="panel pf-block pf-chart-panel" aria-labelledby="pf-daily">
      <div className="panel-head">
        <h2 id="pf-daily">Por día</h2>
        <span className="aside">{single ? `Últimos 14 días hasta ${dayLabel(period.to)}` : spanLabel(period.from, period.to)} · utilidad</span>
      </div>
      <div className="pf-chart-body">
        <ProfitBars bars={bars} label={`Utilidad por día, ${spanLabel(from, period.to)}`} />
      </div>
    </section>
  );
}

/** Mes a mes y semana a semana: el período en curso contra el mismo tramo del anterior. No depende del período elegido. */
function Comparisons({ daily, today }: { daily: Map<string, Acc>; today: string }) {
  const m = monthBuckets(daily, today, 6);
  const w = weekBuckets(daily, today, 12);
  const months = m.buckets;
  if (months.every((b) => b.acc.revenue === 0)) return null;
  const m0 = months[months.length - 1];
  const m1 = months[months.length - 2];
  const w0 = w.buckets[w.buckets.length - 1];
  const w1 = w.buckets[w.buckets.length - 2];
  const projection = monthProjection(m0.acc.profit, m.elapsed, m.days);
  const prevMonth = (k: number) => months.find((x) => x.k === k + 1);
  const prevWeek = (k: number) => w.buckets.find((x) => x.k === k + 1);
  const monthChange = (b: (typeof months)[number]) => (b.k === 0 ? pctChange(b.acc.profit, m.prevToDate.profit) : pctChange(b.acc.profit, prevMonth(b.k)?.acc.profit ?? 0));

  return (
    <section className="panel pf-block" aria-labelledby="pf-compare">
      <div className="panel-head">
        <h2 id="pf-compare">Comparativo</h2>
        <span className="aside">utilidad · el período en curso contra el mismo tramo del anterior · no depende del período elegido</span>
      </div>
      <div className="pf-compare">
        <figure className="pf-fig">
          <figcaption>Por mes</figcaption>
          <p className="og-kpi">
            <strong>{usd0(m0.acc.profit)}</strong> en {monthLabel(m0.from)} <Delta change={pctChange(m0.acc.profit, m.prevToDate.profit)} />
            <span className="muted">vs. {usd0(m.prevToDate.profit)} de {monthLabel(m1.from)} al mismo día ({spanLabel(m1.from, m.prevTo)})</span>
          </p>
          <p className="og-sub muted">
            {projection !== null && <>A este ritmo, {monthLabel(m0.from)} cerraría en ~{usd0(projection)} · </>}
            {capitalize(monthLabel(m1.from))} cerró en {usd0(m1.acc.profit)}
          </p>
          <ProfitBars
            height={130}
            label="Utilidad por mes"
            bars={months.map((b) => ({
              key: b.key,
              label: monthShortLabel(b.from),
              value: b.acc.profit,
              title: `${capitalize(monthLabel(b.from))}${b.k === 0 ? ` (1–${Number(today.slice(8))}, en curso)` : ""}`,
              lines: [...tipLines(b.acc), ...(b.k === 0 ? [`${monthLabel(m1.from)} al mismo día: ${usd(m.prevToDate.profit)}`] : [])],
              current: b.k === 0,
              mark: b.k === 1 ? m.prevToDate.profit : null,
            }))}
          />
        </figure>
        <figure className="pf-fig">
          <figcaption>Por semana <span className="muted">· lunes a domingo</span></figcaption>
          <p className="og-kpi">
            <strong>{usd0(w0.acc.profit)}</strong> esta semana <Delta change={pctChange(w0.acc.profit, w.prevToDate.profit)} />
            <span className="muted">vs. {usd0(w.prevToDate.profit)} la semana pasada a esta altura ({spanLabel(w1.from, w.prevTo)})</span>
          </p>
          <p className="og-sub muted">Semana pasada completa: {usd0(w1.acc.profit)}</p>
          <ProfitBars
            height={130}
            label="Utilidad por semana"
            bars={w.buckets.map((b, i) => ({
              key: b.key,
              label: i === 0 || b.k === 0 || b.k === 6 ? (b.k === 0 ? "esta" : dayLabel(b.from)) : "",
              value: b.acc.profit,
              title: b.k === 0 ? `Esta semana (${spanLabel(b.from, b.to)}, en curso)` : `Semana del ${spanLabel(b.from, b.to)}`,
              lines: [...tipLines(b.acc), ...(b.k === 0 ? [`La pasada a esta altura: ${usd(w.prevToDate.profit)}`] : [`vs. la anterior: ${pctText(pctChange(b.acc.profit, prevWeek(b.k)?.acc.profit ?? 0))}`])],
              current: b.k === 0,
              mark: b.k === 1 ? w.prevToDate.profit : null,
            }))}
          />
        </figure>
      </div>
      <div className="table-scroll">
        <table className="table pf-table pf-months">
          <thead>
            <tr>
              <th>Mes</th>
              <th className="r">Pedidos</th>
              <th className="r">Unidades</th>
              <th className="r">Cobrado</th>
              <th className="r">Costos</th>
              <th className="r">Utilidad</th>
              <th className="r">Margen</th>
              <th className="r">vs. anterior</th>
            </tr>
          </thead>
          <tbody>
            {[...months].reverse().filter((b) => b.acc.revenue > 0 || b.k === 0).map((b) => (
              <tr key={b.key}>
                <td className="strong">
                  {capitalize(monthLabel(b.from))}
                  {b.k === 0 && <div className="sub">1–{Number(today.slice(8))}, en curso</div>}
                </td>
                <td className="num">{fmtInt(b.acc.orders)}</td>
                <td className="num">{fmtInt(b.acc.units)}</td>
                <td className="num">{usd(b.acc.revenue)}</td>
                <td className="num">{usd(b.acc.cost + b.acc.covered_fees)}</td>
                <td className="num"><b data-tone={b.acc.profit < 0 ? "down" : undefined}>{usd(b.acc.profit)}</b></td>
                <td className="num">{pctText(margin(b.acc))}</td>
                <td className="num">
                  <Delta change={monthChange(b)} />
                  {b.k === 0 && <div className="sub">al mismo día</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
