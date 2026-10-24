"use client";

import { useState } from "react";

export type ProfitBar = {
  key: string;
  /** texto bajo la barra (vacío = sin texto) */
  label: string;
  value: number;
  /** encabezado del detalle al pasar el mouse */
  title: string;
  lines: string[];
  /** período en curso: barra clara con borde */
  current?: boolean;
  /** en el período anterior: hasta dónde iba a esta misma altura (línea sobre la barra) */
  mark?: number | null;
};

function niceMax(n: number) {
  if (n <= 0) return 0;
  if (n <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(n));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => n / s <= 4) ?? pow * 10;
  return Math.ceil(n / step) * step;
}
const short = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1000 ? `$${Math.round(a / 100) / 10}K` : `$${Math.round(a)}`;
  return n < 0 ? `−${s}` : s;
};

/**
 * Utilidad por día, semana o mes en barras (en dólares). Si hay pérdidas, las barras bajan de la
 * línea del cero. Detalle al pasar el mouse o tocar; tabla oculta para lectores de pantalla.
 */
export function ProfitBars({ bars, label, height = 170 }: { bars: ProfitBar[]; label: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(1, bars.length);
  const top = niceMax(Math.max(0, ...bars.map((b) => Math.max(b.value, b.mark ?? 0))));
  const bottom = -niceMax(-Math.min(0, ...bars.map((b) => b.value)));
  const range = top - bottom || 1;
  const y = (v: number) => ((top - v) / range) * 100;
  const zero = y(0);
  const gap = n > 40 ? 0.18 : n > 14 ? 0.26 : 0.34;
  const h = hover !== null ? bars[hover] : null;
  const ticks = bottom < 0 ? [top, 0, bottom] : [top, top / 2, 0];
  const tickPos = (t: number) => `${y(t)}%`;

  return (
    <div className="chart pf-chart" style={{ gridTemplateRows: `${height}px 22px` }} onMouseLeave={() => setHover(null)}>
      <div className="chart-y" aria-hidden>
        {ticks.map((t, i) => <span key={i} style={{ top: tickPos(t) }}>{short(t)}</span>)}
      </div>
      <div className="chart-plot">
        <div className="pf-grid" aria-hidden>
          {ticks.map((t, i) => <i key={i} data-zero={t === 0 || undefined} style={{ top: tickPos(t) }} />)}
        </div>
        <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" role="img" aria-label={label}>
          {bars.map((b, i) => {
            const y0 = Math.min(zero, y(b.value));
            const hgt = Math.abs(y(b.value) - zero);
            return (
              <g key={b.key} className="col" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
                <rect className="hit" x={i} y={0} width={1} height={100} />
                {hgt > 0 && (
                  <rect
                    className={b.value < 0 ? "neg" : "del"} data-current={b.current || undefined}
                    x={i + gap / 2} y={y0} width={1 - gap} height={Math.max(hgt, 0.6)} vectorEffect="non-scaling-stroke"
                  />
                )}
                {b.mark !== null && b.mark !== undefined && b.mark > 0 && (
                  <rect className="mark" x={i + gap / 2 - 0.06} y={y(b.mark) - 0.6} width={1 - gap + 0.12} height={1.2} />
                )}
              </g>
            );
          })}
        </svg>
        {h && hover !== null && (
          <div className="chart-tip" style={{ left: `${((hover + 0.5) / n) * 100}%`, top: `${Math.min(zero, y(h.value))}%` }}>
            <b>{h.title}</b>
            {h.lines.map((l) => <span key={l}><br />{l}</span>)}
          </div>
        )}
      </div>
      <div className="chart-x" aria-hidden>
        {bars.map((b, i) => (b.label ? <span key={b.key} style={{ left: `${((i + 0.5) / n) * 100}%` }}>{b.label}</span> : null))}
      </div>
      {/* la tabla va dentro de un div: una tabla no se encoge a 1px y ensancharía la página */}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <tbody>
            {bars.map((b) => <tr key={b.key}><th>{b.title}</th><td>{b.lines.join(" · ")}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
