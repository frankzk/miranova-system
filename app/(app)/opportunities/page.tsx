import Link from "next/link";
import { AccountChips } from "@/components/account-chips";
import { IconChevronRight } from "@/components/icons";
import { PageHead } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { fmtInt, fmtMoney } from "@/lib/format";
import { OPP_GROUPS, sortOpportunities, storeOpportunities, type OppGroup, type OppItem } from "@/lib/opportunities";
import { storeHealth } from "@/lib/queries";
import { getScope } from "@/lib/scope";
import { storeHref } from "@/lib/store-links";
import { typicalTickets } from "@/lib/stores";
import "./opportunities.css";

export const metadata = { title: "Oportunidades" };

const PRIORITY = {
  1: { tag: "Hoy", tone: "danger" },
  2: { tag: "Esta semana", tone: "warning" },
  3: { tag: "Oportunidad", tone: "info" },
} as const;

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<{ g?: string }> }) {
  const sp = await searchParams;
  const accounts = await listAccounts();
  const scope = await getScope(accounts);
  const stores = await storeHealth(scope.account);

  const typical = typicalTickets(stores);
  const all = sortOpportunities(storeOpportunities(stores, typical, (s) => (n) => fmtMoney(n, s.currency, { compact: true })));
  const g = sp.g && sp.g in OPP_GROUPS ? (sp.g as OppGroup) : undefined;
  const items = g ? all.filter((i) => i.group === g) : all;
  const counts = Object.fromEntries((Object.keys(OPP_GROUPS) as OppGroup[]).map((k) => [k, all.filter((i) => i.group === k).length]));
  const today = all.filter((i) => i.priority === 1).length;
  const showAccount = !scope.account && accounts.length > 1;
  const href = (group?: OppGroup) => (group ? `/opportunities?g=${group}` : "/opportunities");

  return (
    <div className="page">
      <PageHead
        title="Oportunidades"
        sub={
          <>
            {fmtInt(all.length)} {all.length === 1 ? "oportunidad detectada" : "oportunidades detectadas"} hoy
            {today > 0 && <> · {fmtInt(today)} para contactar hoy</>} · {scope.label}
          </>
        }
      />

      <AccountChips accounts={accounts} current={scope.account} next={href(g)} />

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
            <Opp key={i.id} i={i} showAccount={showAccount} />
          ))}
        </ol>
      )}

      <p className="footnote">
        Se calculan con los pedidos sin cancelar: ritmo de los últimos 7 días contra los 7 anteriores y promedios de 30 días.
        El ticket bajo se compara con la mediana de las tiendas de la misma cuenta.
      </p>
    </div>
  );
}

function Opp({ i, showAccount }: { i: OppItem; showAccount: boolean }) {
  const p = PRIORITY[i.priority];
  const href = i.subject.type === "store" && i.subject.store_id ? storeHref(i.subject.account_id, i.subject.store_id) : null;
  const body = (
    <>
      <span className="bar" data-tone={i.tone} aria-hidden />
      <span className="main">
        <span className="who">
          <span className="name">{i.subject.name}</span>
          {showAccount && <span className="acct">{i.subject.account_name}</span>}
        </span>
        <span className="what">{i.title}</span>
        <span className="do">
          <b>Acción:</b> {i.action}
        </span>
        <span className="meta">{i.meta}</span>
      </span>
      <span className="side">
        <span className="pill" data-tone={p.tone}>{p.tag}</span>
        {href && <IconChevronRight className="go" aria-hidden />}
      </span>
    </>
  );
  return <li className="opp">{href ? <Link href={href}>{body}</Link> : <div>{body}</div>}</li>;
}
