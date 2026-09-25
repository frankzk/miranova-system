"use client";

import { useState } from "react";

type Day = { day: string; orders: number; delivered: number; problems: number };

function niceMax(n: number) {
  if (n <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(n));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => n / s <= 4) ?? pow * 10;
  return Math.ceil(n / step) * step;
}

const fmtDay = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("es-HN", { timeZone: "UTC", ...opts }).format(new Date(`${iso}T00:00:00Z`)).replace(/\./g, "");

/**
 * Órdenes por día: barra clara = total, parte sólida = entregadas.
 * Las barras van en SVG estirable; los textos en HTML para no deformarse.
 */
export function BarChart({ days }: { days: Day[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(1, days.length);
  const max = niceMax(Math.max(1, ...days.map((d) => d.orders)));
  const pct = (v: number) => (v / max) * 100;
  const gap = n > 60 ? 0.2 : 0.34;
  const labelEvery = n > 45 ? 14 : n > 20 ? 7 : n > 10 ? 2 : 1;
  const h = hover !== null ? days[hover] : null;

  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <div className="chart-y" aria-hidden>
        {[max, max / 2, 0].map((t) => <span key={t}>{Math.round(t)}</span>)}
      </div>
      <div className="chart-plot">
        <div className="chart-grid" aria-hidden><i /><i /><i /></div>
        <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" role="img" aria-label="Órdenes por día en el período">
          {days.map((d, i) => (
            <g
              key={d.day}
              className="col"
              onMouseEnter={() => setHover(i)}
              onClick={() => setHover(i)}
            >
              <rect className="hit" x={i} y={0} width={1} height={100} />
              {d.orders > 0 && <rect className="bar" x={i + gap / 2} y={100 - pct(d.orders)} width={1 - gap} height={pct(d.orders)} />}
              {d.delivered > 0 && (
                <rect className="del" x={i + gap / 2} y={100 - pct(d.delivered)} width={1 - gap} height={pct(d.delivered)} />
              )}
            </g>
          ))}
        </svg>
        {h && hover !== null && (
          <div className="chart-tip" style={{ left: `${((hover + 0.5) / n) * 100}%`, top: `${100 - pct(h.orders)}%` }}>
            <b>{fmtDay(h.day, { weekday: "short", day: "numeric", month: "short" })}</b>
            <br />
            {h.orders} órdenes · {h.delivered} entregadas
            {h.problems > 0 && <> · {h.problems} con problemas</>}
          </div>
        )}
      </div>
      <div className="chart-x" aria-hidden>
        {days.map((d, i) =>
          (n - 1 - i) % labelEvery === 0 ? (
            <span key={d.day} style={{ left: `${((i + 0.5) / n) * 100}%` }}>{fmtDay(d.day, { day: "numeric", month: "short" })}</span>
          ) : null,
        )}
      </div>
      <table className="sr-only">
        <caption>Órdenes por día</caption>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}><th>{d.day}</th><td>{d.orders} órdenes</td><td>{d.delivered} entregadas</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
