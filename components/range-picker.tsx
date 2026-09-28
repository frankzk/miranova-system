import Link from "next/link";
import { GetForm } from "./client";
import { IconCalendar } from "./icons";
import type { Range } from "@/lib/ranges";

/**
 * Rango de fechas propio, al final del selector de período: "Rango" abre dos fechas (desde y
 * hasta). Con un rango aplicado, el botón muestra las fechas y queda marcado.
 */
export function RangePicker({ range, today, path }: { range: Range; today: string; path: string }) {
  const active = range.id === "custom";
  const from = range.days?.from ?? "";
  const to = range.days?.to ?? "";
  return (
    <details className="range-pick" data-active={active || undefined}>
      <summary aria-label={active ? `Rango: ${range.short}. Cambiar` : "Elegir un rango de fechas"} title="Rango de fechas">
        <IconCalendar />
        <span className="t">{active ? range.short : "Rango"}</span>
      </summary>
      <div className="range-panel">
        <GetForm action={path}>
          <div className="range-fields">
            <label className="field">
              <span>Desde</span>
              <input className="input" type="date" name="from" defaultValue={from} max={today} required />
            </label>
            <label className="field">
              <span>Hasta</span>
              <input className="input" type="date" name="to" defaultValue={to || today} max={today} />
            </label>
          </div>
          <div className="range-actions">
            {active && <Link className="btn btn-ghost" href={path}>Quitar rango</Link>}
            <button className="btn btn-primary" type="submit">Aplicar</button>
          </div>
        </GetForm>
      </div>
    </details>
  );
}
