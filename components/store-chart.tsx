"use client";

import { useState } from "react";
import { currencySymbol, fmtInt, fmtMoney } from "@/lib/format";
import {
  CHART_METRICS, CHART_RANGES, fmtDay, metricOf, niceMax, rangeSummary, type ChartMetric, type StoreDay,
} from "@/lib/store-metrics";

const short = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const weekday = (iso: string) =>
  new Intl.DateTimeFormat("es-HN", { timeZone: "UTC", weekday: "short" }).format(new Date(`${iso}T00:00:00Z`)).replace(/\./g, "");

/**
 * Evolución diaria de una tienda: pedidos, ventas, ticket o unidades en 7, 30 o 90 días.
 * Los días sin pedidos se ven como una marca en cero (el hueco es la señal).
 * Mismo estilo que BarChart: barras en SVG estirable y textos en HTML.
 */
export function StoreChart({ daily, currency }: { daily: StoreDay[]; currency: string }) {
  const [metric, setMetric] = useState<ChartMetric>("orders");
  const [range, setRange] = useState<(typeof CHART_RANGES)[number]>(30);
  const [hover, setHover] = useState<number | null>(null);

  const days = daily.slice(-range);
  const n = Math.max(1, days.length);
  const values = days.map((d) => metricOf(d, metric));
  const max = niceMax(Math.max(1, ...values));
  const pct = (v: number) => (v / max) * 100;
  const gap = n > 60 ? 0.2 : n > 20 ? 0.3 : 0.4;
  const labelEvery = n > 45 ? 14 : n > 20 ? 7 : 1;
  const money = metric === "sales" || metric === "ticket";
  const sym = currencySymbol(currency);
  const fmt = (v: number, compact = false) =>
    money
      ? compact ? `${sym}${/[A-Z]$/.test(sym) ? " " : ""}${short.format(v)}` : fmtMoney(v, currency)
      : Number.isInteger(v) ? fmtInt(v) : v.toFixed(1);
  const sum = rangeSummary(days, metric);
  const zeros = days.filter((d) => d.orders === 0).length;
  const h = hover !== null ? days[hover] : null;
  const label = CHART_METRICS[metric].toLowerCase();

  return (
    <div className="store-chart">
      <div className="store-chart-controls">
        <div className="segmented" role="group" aria-label="Métrica">
          {(Object.keys(CHART_METRICS) as ChartMetric[]).map((m) => (
            <button key={m} type="button" aria-pressed={m === metric} onClick={() => setMetric(m)}>
              {m === "ticket" ? <>Ticket<span className="long"> promedio</span></> : CHART_METRICS[m]}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Rango">
          {CHART_RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={r === range} onClick={() => { setRange(r); setHover(null); }}>{r} días</button>
          ))}
        </div>
      </div>

      <div className="chart-total">
        <strong>{fmt(sum.total)}</strong>
        <span className="muted">
          {metric === "ticket" ? `ticket promedio en ${range} días` : `${label} en ${range} días · ${money ? fmtMoney(sum.perDay, currency) : sum.perDay.toFixed(1)} por día`}
          {zeros > 0 && <> · {zeros} {zeros === 1 ? "día" : "días"} sin pedidos</>}
        </span>
      </div>

      <div className="chart" onMouseLeave={() => setHover(null)}>
        <div className="chart-y" aria-hidden>
          {[max, max / 2, 0].map((t) => <span key={t}>{fmt(t, true)}</span>)}
        </div>
        <div className="chart-plot">
          <div className="chart-grid" aria-hidden><i /><i /><i /></div>
          <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" role="img" aria-label={`${CHART_METRICS[metric]} por día, últimos ${range} días`}>
            {days.map((d, i) => {
              const v = values[i];
              return (
                <g key={d.day} className="col" data-on={hover === i || undefined} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
                  <rect className="hit" x={i} y={0} width={1} height={100} />
                  {v > 0 ? (
                    <rect className="del" x={i + gap / 2} y={100 - pct(v)} width={1 - gap} height={pct(v)} data-today={i === n - 1 || undefined} />
                  ) : (
                    <rect className="zero" x={i + gap / 2} y={98.5} width={1 - gap} height={1.5} />
                  )}
                </g>
              );
            })}
          </svg>
          {n <= 14 && (
            <div className="store-chart-values" aria-hidden>
              {days.map((d, i) => (
                <span key={d.day} style={{ left: `${((i + 0.5) / n) * 100}%`, bottom: `${pct(values[i])}%` }}>{fmt(values[i], true)}</span>
              ))}
            </div>
          )}
          {h && hover !== null && (
            <div className="chart-tip" style={{ left: `${((hover + 0.5) / n) * 100}%`, top: `${100 - pct(values[hover])}%` }}>
              <b>{weekday(h.day)} {fmtDay(h.day)}</b>
              {hover === n - 1 && " · hoy"}
              <br />
              {h.orders === 0 ? "Sin pedidos" : (
                <>
                  {fmtInt(h.orders)} {h.orders === 1 ? "pedido" : "pedidos"} · {fmtInt(h.units)} unid.
                  <br />
                  {fmtMoney(h.sales, currency)} · ticket {fmtMoney(h.sales / h.orders, currency)}
                </>
              )}
            </div>
          )}
        </div>
        <div className="chart-x" aria-hidden>
          {days.map((d, i) =>
            (n - 1 - i) % labelEvery === 0 ? (
              <span key={d.day} style={{ left: `${((i + 0.5) / n) * 100}%` }}>{n <= 7 ? weekday(d.day) : fmtDay(d.day)}</span>
            ) : null,
          )}
        </div>
        <table className="sr-only">
          <caption>{CHART_METRICS[metric]} por día</caption>
          <tbody>
            {days.map((d, i) => (
              <tr key={d.day}><th>{d.day}</th><td>{fmt(values[i])}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
