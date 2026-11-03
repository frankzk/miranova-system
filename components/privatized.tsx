// Lo privatizado a cada tienda en Salud de tiendas: la celda junto al ritmo de venta y la sección
// del panel lateral. Los estados y textos vienen de lib/exclusive-idle.ts.
import {
  cellText, coverText, EXCLUSIVE_RULES, EXCLUSIVE_STATES, idleText, itemAction, itemLine, lastOrderText, leadItem, storeContext,
  type ExclusiveItem, type StoreExclusive,
} from "@/lib/exclusive-idle";
import { fmtInt, fmtShort } from "@/lib/format";

function StatePill({ i }: { i: ExclusiveItem }) {
  const st = EXCLUSIVE_STATES[i.state];
  // menos de 5 u. apartadas: el estado se ve, pero en gris (no avisa)
  const quiet = !i.alert && (i.state === "stopped" || i.state === "sleeping");
  return (
    <span className="pill" data-tone={quiet ? undefined : st.tone} title={quiet ? `${st.hint}. Con menos de ${EXCLUSIVE_RULES.minUnits} u. apartadas no avisa.` : st.hint}>
      {st.label}
    </span>
  );
}

/**
 * Celda "Privatizado": una línea compacta (estado del producto más urgente y unidades) o, en la
 * pestaña "Privatizado sin pautar", una línea por producto.
 */
export function PrivatizedCell({ x, expanded = false }: { x: StoreExclusive | undefined; expanded?: boolean }) {
  if (!x) return <span className="subtle">—</span>;
  const title = x.items.map(itemLine).join("\n");
  if (expanded) {
    const ctx = x.worst ? storeContext(x, x.worst) : null;
    return (
      <div className="px-cell">
        <ul className="px-items">
          {x.items.map((i) => (
            <li key={i.product_external_id} data-alert={i.alert || undefined}>
              <StatePill i={i} />
              <span className="px-name">{i.product_name}</span>
              <span className="px-meta">{fmtInt(i.units)} u. · {idleText(i)}</span>
            </li>
          ))}
        </ul>
        {ctx && <span className="px-ctx">{ctx}</span>}
        {x.worst && <span className="px-do">→ {itemAction(x.worst)}</span>}
      </div>
    );
  }
  // el más urgente; si nada avisa, el estado del producto con más unidades (en gris si no avisa)
  return (
    <span className="px-compact" title={title}>
      <StatePill i={leadItem(x)} />
      <span className="px-meta">{cellText(x)}</span>
    </span>
  );
}

const pace = (n14: number) => {
  const d = n14 / 14;
  return d >= 1 ? `${d.toFixed(1)} pedidos/día` : `${fmtInt(n14)} ${n14 === 1 ? "pedido" : "pedidos"} en 2 semanas`;
};

/** Panel lateral: todo lo que la tienda tiene privatizado, con su último pedido y qué hacer. */
export function PrivatizedSection({ x, tz }: { x: StoreExclusive; tz: string }) {
  const synced = x.items.map((i) => i.movements_sync_at).filter((v): v is string => !!v).sort()[0] ?? null;
  const ctx = x.worst ? storeContext(x, x.worst) : null;
  return (
    <div className="section px-section">
      <h3>
        Inventario privatizado{" "}
        <span className="aside">
          {fmtInt(x.units)} u.{x.idle_units > 0 && <> · {fmtInt(x.idle_units)} u. sin pedidos</>}
        </span>
      </h3>
      {ctx && <p className="px-ctx">{ctx.charAt(0).toUpperCase() + ctx.slice(1)}.</p>}
      <ul className="px-list">
        {x.items.map((i) => (
          <li key={i.product_external_id} data-alert={i.alert || undefined}>
            <div className="px-row">
              <span className="px-name">{i.product_name}</span>
              <StatePill i={i} />
            </div>
            <div className="px-facts">
              <span>
                <b>{fmtInt(i.units)} u.</b> apartadas
                {/* sin la reserva guardada solo se sabe que ya las tenía en el movimiento más antiguo que vemos */}
                {i.held_days !== null && <> hace {i.since_known ? "" : "al menos "}{fmtInt(i.held_days)} {i.held_days === 1 ? "día" : "días"}</>}
              </span>
              <span>{idleText(i)}{(i.last_day || i.never) && <> · {lastOrderText(i)}</>}</span>
              {i.n14_before > 0 && (
                <span>
                  Llevaba {pace(i.n14_before)}
                  {coverText(i) && <> · {coverText(i)}</>}
                </span>
              )}
            </div>
            {i.alert && <p className="px-action">→ {itemAction(i)}</p>}
          </li>
        ))}
      </ul>
      {synced && <p className="px-foot">Unidades según los movimientos de Drop leídos el {fmtShort(synced, tz)}.</p>}
    </div>
  );
}
