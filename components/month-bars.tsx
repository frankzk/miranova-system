"use client";

import { useState } from "react";

type Month = { month: string; value: number; detail?: string };

function niceMax(n: number) {
  if (n <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(n));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => n / s <= 4) ?? pow * 10;
  return Math.ceil(n / step) * step;
}
const short = (n: number) => (n >= 1000 ? `$${Math.round(n / 100) / 10}K` : `$${Math.round(n)}`);
const monthName = (m: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("es-HN", { timeZone: "UTC", ...opts }).format(new Date(`${m}-01T12:00:00Z`)).replace(/\./g, "");

/** Una serie por mes (USD), barras con el estilo de los gráficos del panel y detalle al pasar el mouse. */
export function MonthBars({ months, label }: { months: Month[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(1, months.length);
  const max = niceMax(Math.max(1, ...months.map((m) => m.value)));
  const pct = (v: number) => (v / max) * 100;
  const h = hover !== null ? months[hover] : null;
  return (
    <div className="chart chart-money" onMouseLeave={() => setHover(null)}>
      <div className="chart-y" aria-hidden>
        {[max, max / 2, 0].map((t) => <span key={t}>{short(t)}</span>)}
      </div>
      <div className="chart-plot">
        <div className="chart-grid" aria-hidden><i /><i /><i /></div>
        <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" role="img" aria-label={label}>
          {months.map((m, i) => (
            <g key={m.month} className="col" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
              <rect className="hit" x={i} y={0} width={1} height={100} />
              {m.value > 0 && <rect className="del" x={i + 0.2} y={100 - pct(m.value)} width={0.6} height={pct(m.value)} />}
            </g>
          ))}
        </svg>
        {h && hover !== null && (
          <div className="chart-tip" style={{ left: `${((hover + 0.5) / n) * 100}%`, top: `${100 - pct(h.value)}%` }}>
            <b>{monthName(h.month, { month: "long", year: "numeric" })}</b>
            <br />
            {h.value.toLocaleString("en-US", { style: "currency", currency: "USD" })}
            {h.detail && <> · {h.detail}</>}
          </div>
        )}
      </div>
      <div className="chart-x" aria-hidden>
        {months.map((m, i) => (
          <span key={m.month} style={{ left: `${((i + 0.5) / n) * 100}%` }}>{monthName(m.month, { month: "short" })}</span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {months.map((m) => <tr key={m.month}><th>{m.month}</th><td>{m.value.toFixed(2)} USD</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}
