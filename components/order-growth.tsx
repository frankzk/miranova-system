import { fmtInt } from "@/lib/format";
import {
  clock, dayMonth, monthName, monthProjection, monthShort, monthToDateLabels, pctChange, toDate, trimLeading, weekRange, weekToDateLabel,
  type OrderGrowth as Growth,
} from "@/lib/growth";

/**
 * Inicio › Órdenes: crecimiento semana a semana y mes a mes (órdenes recibidas). El período en
 * curso se compara contra el mismo tramo del anterior, hasta el mismo día y hora, para saber si se
 * está creciendo sin esperar a que termine. No depende del período elegido arriba.
 */
export function OrderGrowth({ g }: { g: Growth }) {
  const weeks = g.weeks ?? [];
  const months = trimLeading(g.months);
  if (weeks.every((w) => w.orders === 0)) return null;
  const w = toDate(g, "week");
  const m = toDate(g, "month");
  const ml = monthToDateLabels(g.now);
  const cur = g.months.find((x) => x.k === 0)?.month ?? g.now.slice(0, 7);
  const prev = g.months.find((x) => x.k === 1);
  const before = g.months.find((x) => x.k === 2);
  const weekBefore = g.weeks.find((x) => x.k === 2)?.orders ?? 0;
  const projection = monthProjection(g);

  return (
    <div className="og">
      <p className="og-head">
        Crecimiento <span className="muted">· órdenes recibidas · no depende del período</span>
      </p>

      <figure className="og-period">
        <figcaption className="og-name">Por semana <span className="muted">· lunes a domingo</span></figcaption>
        <p className="og-kpi">
          <strong>{fmtInt(w.current)}</strong> esta semana <Delta change={w.change} />
          <span className="muted">vs. {fmtInt(w.prev)} la semana pasada en el mismo tramo ({weekToDateLabel(g.now)})</span>
        </p>
        <p className="og-sub muted">
          Semana pasada completa: {fmtInt(w.prevFull)} <Delta change={pctChange(w.prevFull, weekBefore)} /> vs. la anterior
        </p>
        <Bars
          items={weeks.map((x) => ({
            key: x.start,
            k: x.k,
            orders: x.orders,
            title:
              x.k === 0
                ? `Esta semana (${weekRange(x.start)}), ${weekToDateLabel(g.now)}: ${fmtInt(x.orders)} órdenes · ${pctText(w.change)} vs. ${fmtInt(w.prev)} a la misma altura de la semana pasada`
                : `Semana del ${weekRange(x.start)}: ${fmtInt(x.orders)} órdenes · ${pctText(pctChange(x.orders, weeks.find((y) => y.k === x.k + 1)?.orders ?? 0))} vs. la anterior`,
          }))}
          prevToDate={g.week_prev_to_date}
          showValue={(k) => k <= 1}
        />
        <div className="og-ends muted" aria-hidden>
          <span>sem. del {dayMonth(weeks[0]?.start ?? g.now.slice(0, 10))}</span>
          <span>esta semana</span>
        </div>
      </figure>

      {months.length > 0 && (
        <figure className="og-period">
          <figcaption className="og-name">Por mes</figcaption>
          <p className="og-kpi">
            <strong>{fmtInt(m.current)}</strong> en {monthName(cur)} <Delta change={m.change} />
            <span className="muted">vs. {fmtInt(m.prev)} del {ml.prev}, el mismo tramo ({ml.current}, hasta las {clock(g.now)})</span>
          </p>
          <p className="og-sub muted">
            {projection !== null && <>A este ritmo, {monthName(cur)} cerraría en ~{fmtInt(projection)} · </>}
            {prev && <>{capitalize(monthName(prev.month))} cerró en {fmtInt(prev.orders)}</>}
            {prev && before && before.orders > 0 && <> <Delta change={pctChange(prev.orders, before.orders)} /> vs. {monthName(before.month)}</>}
          </p>
          <Bars
            items={months.map((x) => ({
              key: x.month,
              k: x.k,
              orders: x.orders,
              title:
                x.k === 0
                  ? `${capitalize(monthName(x.month))} (${ml.current}): ${fmtInt(x.orders)} órdenes · ${pctText(m.change)} vs. ${fmtInt(m.prev)} del ${ml.prev}`
                  : `${capitalize(monthName(x.month))}: ${fmtInt(x.orders)} órdenes · ${pctText(pctChange(x.orders, g.months.find((y) => y.k === x.k + 1)?.orders ?? 0))} vs. el mes anterior`,
            }))}
            prevToDate={g.month_prev_to_date}
            showValue={() => true}
          />
          <div className="og-labels" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }} aria-hidden>
            {months.map((x) => {
              const change = x.k === 0 ? m.change : pctChange(x.orders, g.months.find((y) => y.k === x.k + 1)?.orders ?? 0);
              return (
                <span key={x.month}>
                  {monthShort(x.month, g.now)}
                  <Delta change={change} />
                </span>
              );
            })}
          </div>
        </figure>
      )}

      <p className="og-note muted">
        <span className="og-key og-key-cur" aria-hidden /> en curso · <span className="og-key og-key-mark" aria-hidden /> hasta dónde iba el período anterior a esta misma altura.
        El porcentaje del período en curso compara contra ese tramo, no contra el período completo.
      </p>
    </div>
  );
}

function Bars({ items, prevToDate, showValue }: {
  items: { key: string; k: number; orders: number; title: string }[];
  prevToDate: number;
  showValue: (k: number) => boolean;
}) {
  const max = Math.max(1, ...items.map((x) => x.orders));
  return (
    <div className="og-cols" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }} role="img" aria-label={items.map((x) => x.title).join(". ")}>
      {items.map((x) => (
        <span key={x.key} className="col" title={x.title}>
          <span className="bar" data-current={x.k === 0 || undefined} style={{ height: `${(x.orders / max) * 100}%` }}>
            {showValue(x.k) && <span className="v">{fmtInt(x.orders)}</span>}
            {x.k === 1 && x.orders > 0 && <i className="mark" style={{ bottom: `${Math.min(100, (prevToDate / x.orders) * 100)}%` }} />}
          </span>
        </span>
      ))}
    </div>
  );
}

const pctText = (c: number | null) => (c === null ? "sin base para comparar" : `${c > 0 ? "+" : c < 0 ? "−" : ""}${Math.abs(Math.round(c * 100))}%`);

function Delta({ change }: { change: number | null }) {
  if (change === null) return null;
  const p = Math.round(change * 100);
  return (
    <span className="delta" data-tone={p >= 1 ? "up" : p <= -1 ? "down" : "flat"}>
      {p > 0 ? "↑" : p < 0 ? "↓" : ""} {Math.abs(p)}%
    </span>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
