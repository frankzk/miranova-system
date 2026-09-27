// Seguimiento comercial de una tienda (CRM interno): historial, alta de registros y
// efecto medido de cada contacto (7 días antes vs. 7 días desde el contacto). Sin permiso de
// editar (actions = null) el historial es de solo lectura.
import { FollowupForm, FollowupStatusForm, type FollowupState } from "./followup-forms";
import { IconPlus } from "./icons";
import { SideSheet } from "./side-sheet";
import { followupOwners, listFollowups, type Followup } from "@/lib/followups";
import { fmtMoney } from "@/lib/format";
import { daysBetween, fmtDay, FOLLOWUP_STATUS, impact, OPEN_STATUSES, type StoreDay } from "@/lib/store-metrics";

type Action = (prev: FollowupState, form: FormData) => Promise<FollowupState>;

export type StoreFollowupsProps = {
  accountId: string;
  storeId: string;
  storeName: string;
  currency: string;
  /** Serie diaria de la ficha (90 días) para medir el efecto de cada contacto. */
  daily: StoreDay[];
  /** Hoy en la zona de la cuenta (YYYY-MM-DD). */
  today: string;
  actions: { add: Action; update: Action } | null;
  /** Nombre del usuario de la sesión: responsable por defecto de un seguimiento nuevo. */
  me?: string;
};

export async function StoreFollowups({ accountId, storeId, storeName, currency, daily, today, actions, me }: StoreFollowupsProps) {
  const [items, owners] = await Promise.all([listFollowups(accountId, storeId), actions ? followupOwners() : Promise.resolve([])]);
  const open = items.filter((f) => OPEN_STATUSES.includes(f.status));

  return (
    <section id="seguimiento" className="panel store-followups" aria-labelledby="fu-title">
      <div className="panel-head">
        <h2 id="fu-title">Seguimiento Miranova</h2>
        <span className="aside">
          {items.length ? `${items.length} ${items.length === 1 ? "registro" : "registros"} · ${open.length} ${open.length === 1 ? "abierto" : "abiertos"}` : "Interno"}
        </span>
        {actions && (
          <SideSheet
            triggerClass="btn btn-sm"
            trigger={<><IconPlus /> Nuevo seguimiento</>}
            title="Nuevo seguimiento"
            sub={<>{storeName} · registro interno de Miranova</>}
          >
            <div className="section">
              <FollowupForm action={actions.add} accountId={accountId} storeId={storeId} storeName={storeName} today={today} owners={owners} owner={me} />
            </div>
          </SideSheet>
        )}
      </div>
      {items.length === 0 && (
        <p className="panel-body muted fu-empty">
          Registra cada contacto con la tienda (qué se recomendó y qué se hizo) para medir su efecto en las ventas de los 7 días siguientes.
        </p>
      )}
      {items.length > 0 && (
        <ol className="fu-list">
          {items.map((f) => (
            <Entry key={f.id} f={f} daily={daily} today={today} currency={currency} update={actions?.update ?? null} />
          ))}
        </ol>
      )}
    </section>
  );
}

function Entry({ f, daily, today, currency, update }: { f: Followup; daily: StoreDay[]; today: string; currency: string; update: Action | null }) {
  const st = FOLLOWUP_STATUS[f.status] ?? FOLLOWUP_STATUS.pendiente;
  const overdue = f.next_followup !== null && f.next_followup < today && OPEN_STATUSES.includes(f.status);
  return (
    <li className="fu-item">
      <div className="fu-top">
        <strong>{fmtDay(f.contacted_at, today)}</strong>
        <span className="muted">{f.owner || "Sin responsable"}</span>
        <span className="pill" data-tone={st.tone}>{st.label}</span>
        {f.next_followup && (
          <span className="fu-next" data-overdue={overdue || undefined}>
            Próximo: {fmtDay(f.next_followup, today)}
            {overdue && ` · vencido hace ${daysBetween(f.next_followup, today)} d`}
          </span>
        )}
      </div>
      {f.recommendation && <p><span className="k">Recomendación</span>{f.recommendation}</p>}
      {f.action_taken && <p><span className="k">Acción</span>{f.action_taken}</p>}
      <Impact daily={daily} contactedAt={f.contacted_at} today={today} currency={currency} />
      {update && (
        <details className="fu-edit">
          <summary>Cambiar estado</summary>
          <FollowupStatusForm action={update} id={f.id} accountId={f.account_id} status={f.status} next={f.next_followup} />
        </details>
      )}
    </li>
  );
}

function Impact({ daily, contactedAt, today, currency }: { daily: StoreDay[]; contactedAt: string; today: string; currency: string }) {
  const r = impact(daily, contactedAt, today);
  if (r.state === "measuring") {
    return <p className="fu-impact" data-state="measuring">Efecto: midiendo… (faltan {r.daysLeft} {r.daysLeft === 1 ? "día" : "días"})</p>;
  }
  if (r.state === "no_data") return <p className="fu-impact" data-state="measuring">Efecto: fuera de los últimos 90 días</p>;
  const money = (n: number | null) => (n === null ? "—" : fmtMoney(n, currency));
  const tone = (c: number | null) => (c === null ? "flat" : c > 0.1 ? "up" : c < -0.1 ? "down" : "flat");
  const pct = (c: number | null) => (c === null ? "" : ` (${c > 0 ? "+" : ""}${Math.round(c * 100)}%)`);
  return (
    <p className="fu-impact" title="7 días antes de la fecha de contacto vs. los 7 días desde el contacto">
      <span className="k">Efecto</span>
      Antes: {r.before.perDay.toFixed(1)} pedidos/día → Después:{" "}
      <b className="delta" data-tone={tone(r.ordersChange)}>{r.after.perDay.toFixed(1)}{pct(r.ordersChange)}</b>
      {" · "}Ticket {money(r.before.ticket)} → <b className="delta" data-tone={tone(r.ticketChange)}>{money(r.after.ticket)}</b>
    </p>
  );
}
