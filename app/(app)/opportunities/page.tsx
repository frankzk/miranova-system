import Link from "next/link";
import { AccountChips } from "@/components/account-chips";
import { ContactQuick, type QuickContact } from "@/components/contact-quick";
import { IconChevronRight } from "@/components/icons";
import { PageHead } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { requirePermission } from "@/lib/auth";
import { contactIndex, contactKey } from "@/lib/contacts";
import { fmtInt, fmtMoney, todayIn } from "@/lib/format";
import { pendingFollowups, type Followup } from "@/lib/followups";
import { crossSell } from "@/lib/cross-sell";
import { inventoryAlerts } from "@/lib/inventory";
import { inventoryStatus, inventorySupply } from "@/lib/inventory-data";
import { allStoreOpportunities, inventoryItems, OPP_GROUPS, productItems, sortOpportunities, withCrossSell, type OppGroup, type OppItem } from "@/lib/opportunities";
import { can, permissionFlags, type PermissionFlags } from "@/lib/permissions";
import { productInsights } from "@/lib/product-insights";
import { productPerformance } from "@/lib/product-performance";
import { storeHealthRecent } from "@/lib/queries";
import { getScope } from "@/lib/scope";
import { storeHref } from "@/lib/store-links";
import { daysBetween, fmtDay, FOLLOWUP_STATUS } from "@/lib/store-metrics";
import { storeProductMatrix } from "@/lib/store-product-matrix";
import { typicalTickets } from "@/lib/stores";
import "./opportunities.css";

export const metadata = { title: "Oportunidades" };

const PRIORITY = {
  1: { tag: "Hoy", tone: "danger" },
  2: { tag: "Esta semana", tone: "warning" },
  3: { tag: "Oportunidad", tone: "info" },
} as const;

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<{ g?: string }> }) {
  const [user, accounts] = await Promise.all([requirePermission("opportunities"), listAccounts()]);
  const perms = permissionFlags(user);
  const sp = await searchParams;
  const scope = await getScope(accounts);
  // seguimientos y contactos son de Tiendas: sin ese permiso ni se cargan
  const [stores, followups, products, matrix, inventory, contacts, supply] = await Promise.all([
    storeHealthRecent(scope.account),
    can(user, "stores") ? pendingFollowups(scope.account) : Promise.resolve([] as Followup[]),
    productPerformance(scope.account),
    storeProductMatrix(scope.account, 30),
    inventoryStatus(scope.account),
    can(user, "stores") ? contactIndex() : Promise.resolve(new Map() as Awaited<ReturnType<typeof contactIndex>>),
    // pedidos de reposición ya hechos: no se vuelve a sugerir pedir lo que ya viene en camino
    inventorySupply(scope.account),
  ]);
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "";
  const today = todayIn(scope.tz);

  const typical = typicalTickets(stores);
  const storeItems = allStoreOpportunities(stores, typical, (s) => (n) => fmtMoney(n, s.currency, { compact: true }));
  const all = sortOpportunities([
    ...withCrossSell(storeItems, crossSell(matrix), accountName),
    ...productItems(productInsights(products), accountName),
    ...inventoryItems(inventoryAlerts(inventory, supply, today), accountName),
  ]);
  // seguimiento abierto por tienda: se muestra junto a su oportunidad para no contactarla dos veces
  const open = new Map<string, Followup>();
  for (const f of followups) if (!open.has(`${f.account_id}:${f.store_id}`)) open.set(`${f.account_id}:${f.store_id}`, f);
  const due = followups.filter((f) => f.next_followup !== null && f.next_followup <= today);
  const g = sp.g && sp.g in OPP_GROUPS ? (sp.g as OppGroup) : undefined;
  const items = g ? all.filter((i) => i.group === g) : all;
  const counts = Object.fromEntries((Object.keys(OPP_GROUPS) as OppGroup[]).map((k) => [k, all.filter((i) => i.group === k).length]));
  const urgent = all.filter((i) => i.priority === 1).length;
  const showAccount = !scope.account && accounts.length > 1;
  const href = (group?: OppGroup) => (group ? `/opportunities?g=${group}` : "/opportunities");

  return (
    <div className="page">
      <PageHead
        title="Oportunidades"
        sub={
          <>
            {fmtInt(all.length)} {all.length === 1 ? "oportunidad detectada" : "oportunidades detectadas"} hoy
            {urgent > 0 && <> · {fmtInt(urgent)} para contactar hoy</>}
            {due.length > 0 && <> · {fmtInt(due.length)} {due.length === 1 ? "seguimiento vence" : "seguimientos vencen"} hoy</>} · {scope.label}
          </>
        }
      />

      <AccountChips accounts={accounts} current={scope.account} next={href(g)} />

      {followups.length > 0 && !g && <FollowupsPanel items={followups} today={today} showAccount={showAccount} />}

      <nav className="tabs" aria-label="Tipo de oportunidad">
        <Link href={href()} aria-current={!g}>
          Todas <span className="c">{fmtInt(all.length)}</span>
        </Link>
        {(Object.keys(OPP_GROUPS) as OppGroup[]).map((k) => (
          <Link key={k} href={href(k)} aria-current={g === k} title={OPP_GROUPS[k].hint}>
            {OPP_GROUPS[k].label} <span className="c">{fmtInt(counts[k] ?? 0)}</span>
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <section className="panel">
          <div className="empty">
            <h3>{all.length === 0 ? "Nada que atender hoy" : "Nada en esta categoría"}</h3>
            <p>
              {all.length === 0
                ? "Ninguna tienda se frenó ni cayó, y no hay oportunidades claras de ticket o de un segundo producto."
                : "Prueba con otra pestaña."}
            </p>
          </div>
        </section>
      ) : (
        <ol className="opp-list">
          {items.map((i) => (
            <Opp
              key={i.id}
              i={i}
              showAccount={showAccount}
              follow={open.get(`${i.subject.account_id}:${i.subject.store_id}`)}
              contact={i.subject.store_id ? contacts.get(contactKey({ account_id: i.subject.account_id, store_id: i.subject.store_id })) : undefined}
              today={today}
              perms={perms}
            />
          ))}
        </ol>
      )}

      <p className="footnote">
        Se calculan con los pedidos sin cancelar: ritmo de los últimos 7 días contra los 7 anteriores y promedios de 30 días.
        El ticket bajo se compara con la mediana de las tiendas de la misma cuenta; la venta cruzada, con las tiendas que venden
        el mismo producto principal (matriz tienda × producto de 30 días).
      </p>
    </div>
  );
}

function Opp({ i, showAccount, follow, contact, today, perms }: { i: OppItem; showAccount: boolean; follow?: Followup; contact?: QuickContact; today: string; perms: PermissionFlags }) {
  const p = PRIORITY[i.priority];
  // la tarjeta enlaza solo a secciones que el usuario puede abrir
  const href = i.subject.type === "store" && i.subject.store_id
    ? (perms.stores ? storeHref(i.subject.account_id, i.subject.store_id) : null)
    : i.subject.type === "account" ? (perms.accounts ? "/settings" : null)
    : i.subject.type === "product" && perms.products
      ? (["stockout", "low_stock", "returns"].includes(i.kind) ? "/products/inventory" : "/products/performance")
      : null;
  const body = (
    <>
      <span className="bar" data-tone={i.tone} aria-hidden />
      <span className="main">
        <span className="who">
          <span className="name">{i.subject.name}</span>
          {i.subject.type !== "store" && <span className="kind">{i.subject.type === "product" ? "Producto" : "Cuenta"}</span>}
          {showAccount && <span className="acct">{i.subject.account_name}</span>}
        </span>
        <span className="what">{i.title}</span>
        <span className="do">
          <b>Acción:</b> {i.action}
        </span>
        <span className="meta">{i.meta}</span>
        {follow && (
          <span className="follow">
            En seguimiento{follow.owner && <> con {follow.owner}</>} · {FOLLOWUP_STATUS[follow.status].label.toLowerCase()}
            {follow.next_followup && <> · próximo {fmtDay(follow.next_followup, today)}</>}
          </span>
        )}
      </span>
      <span className="side">
        <span className="pill" data-tone={p.tone}>{p.tag}</span>
        {href && <IconChevronRight className="go" aria-hidden />}
      </span>
    </>
  );
  // tiendas: acceso directo a su grupo de WhatsApp (fuera del enlace de la tarjeta)
  // (sin contacto y sin permiso de editar, ContactQuick no muestra nada: no reservar su espacio)
  const isStore = i.subject.type === "store" && !!i.subject.store_id && !!href && (!!contact?.group || !!contact?.phone || perms.stores_edit);
  return (
    <li className={isStore ? "opp has-qc" : "opp"}>
      {href ? <Link href={href}>{body}</Link> : <div>{body}</div>}
      {isStore && <ContactQuick c={contact} storeHref={href} name={i.subject.name} canEdit={perms.stores_edit} />}
    </li>
  );
}

/** Seguimientos abiertos: primero los vencidos o de hoy, luego los próximos. */
function FollowupsPanel({ items, today, showAccount }: { items: Followup[]; today: string; showAccount: boolean }) {
  const shown = items.slice(0, 8);
  return (
    <section className="panel opp-follow" aria-labelledby="opp-follow-title">
      <div className="panel-head">
        <h2 id="opp-follow-title">Seguimientos abiertos</h2>
        <span className="aside">{fmtInt(items.length)} {items.length === 1 ? "pendiente o en curso" : "pendientes o en curso"}</span>
      </div>
      <ul className="list-rows panel-flush">
        {shown.map((f) => {
          const late = f.next_followup !== null ? daysBetween(f.next_followup, today) : null;
          return (
            <li key={f.id}>
              <Link href={`${storeHref(f.account_id, f.store_id)}#seguimiento`}>
                <span className="t">{f.store_name ?? f.store_id}</span>
                <span className="pill" data-tone={late === null ? "neutral" : late > 0 ? "danger" : late === 0 ? "warning" : "info"}>
                  {late === null ? "Sin fecha" : late > 0 ? `Vencido hace ${late} d` : late === 0 ? "Hoy" : `En ${-late} d`}
                </span>
                <span className="s">
                  {f.recommendation ?? "Sin recomendación"}
                  {f.owner && <> · {f.owner}</>}
                  {showAccount && <> · contactada {fmtDay(f.contacted_at, today)}</>}
                </span>
                <span className="s" style={{ textAlign: "right" }}>{FOLLOWUP_STATUS[f.status].label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {items.length > shown.length && <p className="panel-body muted">y {fmtInt(items.length - shown.length)} más</p>}
    </section>
  );
}
