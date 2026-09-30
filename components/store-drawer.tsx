// Panel lateral de una tienda en Salud de tiendas: cifras rápidas, qué hacer, contacto del dueño
// y el historial de seguimiento del equipo, sin salir del listado. La ficha completa queda a un clic.
import Link from "next/link";
import { DrawerClose } from "./client";
import type { ContactState } from "./contact-forms";
import type { FollowupState } from "./followup-forms";
import { IconArrowRight, IconExternal } from "./icons";
import { StoreContactSection } from "./store-contact";
import { StoreFollowups } from "./store-followups";
import type { StoreContactView } from "@/lib/contacts";
import { fmtInt, fmtMoney } from "@/lib/format";
import { storeHref } from "@/lib/store-links";
import type { StoreDetail } from "@/lib/store-metrics";
import { HEALTH, type Health, type Opportunity } from "@/lib/stores";

type Action<S> = (prev: S, form: FormData) => Promise<S>;

export type StoreDrawerProps = {
  d: StoreDetail;
  contact: StoreContactView;
  health: Health | null;
  ops: Opportunity[];
  closeHref: string;
  me: string;
  canOrders: boolean;
  /** null = solo lectura (sin permiso de Editar tiendas). */
  actions: {
    contact: { save: Action<ContactState>; link: Action<ContactState>; unlink: Action<ContactState> };
    followup: { add: Action<FollowupState>; update: Action<FollowupState> };
  } | null;
};

export function StoreDrawer({ d, contact, health, ops, closeHref, me, canOrders, actions }: StoreDrawerProps) {
  const { store: s, kpis: k } = d;
  const full = storeHref(s.account_id, s.store_id);
  const closed = k.delivered30 + k.failed30;
  const delivery = closed >= 5 ? Math.round((k.delivered30 / closed) * 100) : null;
  const change = k.prev7 > 0 ? Math.round(((k.d7 - k.prev7) / k.prev7) * 100) : null;

  return (
    <>
      <div className="drawer-head sheet-head">
        <div className="grow">
          <h2 className="sheet-title">{s.name}</h2>
          <p className="sheet-sub">
            {health && <><span className="pill" data-tone={HEALTH[health].tone} title={HEALTH[health].hint}>{HEALTH[health].label}</span>{" "}</>}
            {lastSale(k.days_since)} · {s.account_name}
          </p>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <Link className="btn btn-ghost btn-icon" href={full} prefetch={false} aria-label="Abrir la ficha completa" title="Abrir la ficha completa">
            <IconExternal />
          </Link>
          <DrawerClose href={closeHref} />
        </div>
      </div>

      <div className="drawer-body sheet-body sd-drawer">
        <dl className="sd-drawer-kpis">
          <div><dt>Hoy</dt><dd>{fmtInt(k.today)}</dd></div>
          <div>
            <dt>7 días</dt>
            <dd>
              {fmtInt(k.d7)}
              {change !== null && (
                <span className="delta" data-tone={change > 15 ? "up" : change < -15 ? "down" : "flat"}>
                  {change > 0 ? "↑" : change < 0 ? "↓" : ""} {Math.abs(change)}%
                </span>
              )}
            </dd>
          </div>
          <div><dt>Ticket 30 d</dt><dd>{k.ticket === null ? "—" : fmtMoney(k.ticket, s.currency, { compact: true })}</dd></div>
          <div><dt>Entrega 30 d</dt><dd>{delivery === null ? "—" : `${delivery}%`}</dd></div>
        </dl>

        {ops.length > 0 && (
          <div className="section">
            <h3>Qué hacer</h3>
            <ul className="sd-ops-list sd-drawer-ops">
              {ops.slice(0, 3).map((o) => (
                <li key={o.kind} data-priority={o.priority}>
                  <span className="t">{o.text}</span>
                  <span className="a">{o.action}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <StoreContactSection
          view={contact}
          store={{ accountId: s.account_id, storeId: s.store_id, storeName: s.name }}
          actions={actions?.contact ?? null}
          fullHref={full}
        />

        <StoreFollowups
          accountId={s.account_id}
          storeId={s.store_id}
          storeName={s.name}
          currency={s.currency}
          daily={d.daily}
          today={s.today}
          actions={actions?.followup ?? null}
          me={me}
          variant="drawer"
        />

        <div className="sd-drawer-foot">
          <Link className="btn" href={full} prefetch={false}>Ficha completa <IconArrowRight /></Link>
          {canOrders && <Link className="btn btn-ghost" href={`/orders?dropshipper=${encodeURIComponent(s.name)}`} prefetch={false}>Ver pedidos</Link>}
        </div>
      </div>
    </>
  );
}

function lastSale(d: number | null) {
  if (d === null) return "Sin ventas";
  if (d === 0) return "Última venta hoy";
  if (d === 1) return "Última venta ayer";
  return `Sin vender hace ${d} días`;
}
