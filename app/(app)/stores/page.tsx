import Link from "next/link";
import { AccountChips } from "@/components/account-chips";
import { ColumnFilter, type FilterOption } from "@/components/column-filter";
import { PageHead } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { fmtInt, fmtMoney } from "@/lib/format";
import { storeHealth } from "@/lib/queries";
import { getScope } from "@/lib/scope";
import {
  change, classify, deliveryRate, HEALTH, HEALTH_ORDER, opportunities, sortStores, STORE_SORTS, toContact, typicalTickets,
  type Health, type Opportunity, type StoreRow, type StoreSort,
} from "@/lib/stores";

export const metadata = { title: "Salud de tiendas" };

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};

export default async function StoresPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const accounts = await listAccounts();
  const scope = await getScope(accounts);
  const all = await storeHealth(scope.account);

  const hParam = one(sp, "h");
  const h = hParam && hParam in HEALTH ? (hParam as Health) : undefined;
  const sParam = one(sp, "sort");
  const sort: StoreSort = sParam && sParam in STORE_SORTS ? (sParam as StoreSort) : "d7_desc";

  const health = new Map(all.map((s) => [s, classify(s)]));
  const counts = Object.fromEntries(HEALTH_ORDER.map((k) => [k, all.filter((s) => health.get(s) === k).length]));
  const rows = sortStores(h ? all.filter((s) => health.get(s) === h) : all, sort);
  const typical = typicalTickets(all);
  const money = (s: StoreRow) => (n: number) => fmtMoney(n, s.currency, { compact: true });
  const contact = toContact(all);
  const showAccount = !scope.account && accounts.length > 1;

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { h, sort: sort === "d7_desc" ? undefined : sort, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return p.toString();
  };
  const href = (patch: Record<string, string | undefined>) => {
    const s = qs(patch);
    return s ? `/stores?${s}` : "/stores";
  };
  const sortCol = (label: string, keys: StoreSort[], align: "left" | "right" = "right", title?: string) => (
    <ColumnFilter
      path="/stores"
      label={label}
      param="sort"
      align={align}
      query={qs({ sort: undefined })}
      current={keys.includes(sort) && sort !== "d7_desc" ? sort : undefined}
      allLabel={STORE_SORTS.d7_desc}
      options={keys.filter((k) => k !== "d7_desc").map((k): FilterOption => ({ value: k, label: STORE_SORTS[k] }))}
      title={title}
    />
  );
  const ordersHref = (s: StoreRow) => `/orders?dropshipper=${encodeURIComponent(s.name)}`;

  return (
    <div className="page">
      <PageHead
        title="Salud de tiendas"
        sub={<>{fmtInt(all.length)} tiendas con pedidos en 60 días · {scope.label} · ritmo de los últimos 7 días vs. los 7 anteriores</>}
      />

      <AccountChips accounts={accounts} current={scope.account} next={href({})} />

      {contact.length > 0 && !h && (
        <section className="panel contact-today">
          <div className="panel-head">
            <h2>Contactar hoy</h2>
            <span className="aside">Las que más pedidos dejaron de hacer esta semana</span>
          </div>
          <ul className="list-rows panel-flush">
            {contact.map((s) => {
              const ops = opportunities(s, typical[s.account_id], money(s));
              return (
                <li key={`${s.account_id}:${s.store_id}`}>
                  <Link href={ordersHref(s)}>
                    <span className="t">{s.name}</span>
                    <HealthPill h={health.get(s)!} />
                    <span className="s">
                      {fmtInt(s.prev7)} → {fmtInt(s.d7)} pedidos · {lastSale(s)}
                      {showAccount && <> · {s.account_name}</>}
                    </span>
                    <span className="s reason">{ops[0] ? `${ops[0].text} → ${ops[0].action}` : ""}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <nav className="tabs" aria-label="Filtrar por estado">
        <Link href={href({ h: undefined })} aria-current={!h}>
          Todas <span className="c">{fmtInt(all.length)}</span>
        </Link>
        {HEALTH_ORDER.map((k) => (
          <Link key={k} href={href({ h: k })} aria-current={h === k} title={HEALTH[k].hint}>
            <span className="dot" data-tone={HEALTH[k].tone} aria-hidden />
            {HEALTH[k].label} <span className="c">{fmtInt(counts[k] ?? 0)}</span>
          </Link>
        ))}
      </nav>

      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty">
            <h3>{all.length === 0 ? "Aún no hay tiendas" : "Ninguna tienda en este estado"}</h3>
            <p>{all.length === 0 ? "Cuando lleguen órdenes con dropshipper en los últimos 60 días, aparecerán aquí." : "Prueba con otra pestaña."}</p>
          </div>
        ) : (
          <>
            <ul className="store-cards only-sm">
              {rows.map((s) => (
                <li key={`${s.account_id}:${s.store_id}`}>
                  <div className="top">
                    <Link className="strong" href={ordersHref(s)}>{s.name}</Link>
                    <HealthPill h={health.get(s)!} />
                  </div>
                  <div className="sub">{lastSale(s)}{showAccount && <> · {s.account_name}</>}</div>
                  <Spark days={s.daily} />
                  <dl>
                    <div><dt>Hoy</dt><dd>{fmtInt(s.today)}</dd></div>
                    <div><dt>7 días</dt><dd>{fmtInt(s.d7)}</dd></div>
                    <div><dt>Ritmo/día</dt><dd>{(s.d7 / 7).toFixed(1)}</dd></div>
                    <div><dt>Variación</dt><dd><Delta s={s} /></dd></div>
                    <div><dt>Días activos</dt><dd>{s.active7}/7</dd></div>
                    <div><dt>Ticket</dt><dd>{s.ticket === null ? "—" : fmtMoney(s.ticket, s.currency)}</dd></div>
                    <div><dt>Unid./ped.</dt><dd>{s.units_per_order?.toFixed(2) ?? "—"}</dd></div>
                    <div><dt>Te toca</dt><dd>{s.vendor_per_order === null ? "—" : fmtMoney(s.vendor_per_order, s.currency)}</dd></div>
                  </dl>
                  <Ops ops={opportunities(s, typical[s.account_id], money(s))} />
                </li>
              ))}
            </ul>

            <div className="table-scroll not-sm">
              <table className="table stores">
                <thead>
                  <tr>
                    <th>{sortCol("Tienda", ["d7_desc", "silent"], "left")}</th>
                    <th className="r">{sortCol("Hoy", ["today_desc"])}</th>
                    <th className="r">{sortCol("7 días", ["d7_desc", "d7_asc"])}</th>
                    <th className="r" title="Pedidos por día, promedio de los últimos 7 días">Ritmo/día</th>
                    <th className="r">{sortCol("Variación", ["drop", "rise"], "right", "Ritmo de los últimos 7 días vs. los 7 anteriores")}</th>
                    <th className="r">{sortCol("Días activos", ["active_desc", "active_asc"], "right", "Días con al menos un pedido, de los últimos 7")}</th>
                    <th className="r">{sortCol("Ticket", ["ticket_desc", "ticket_asc"], "right", "Venta promedio por pedido, últimos 30 días")}</th>
                    <th className="r hide-lg">{sortCol("Unid./pedido", ["units_asc", "units_desc"], "right", "Productos promedio por pedido, últimos 30 días")}</th>
                    <th className="r hide-lg">{sortCol("Te toca/pedido", ["vendor_desc"], "right", "Lo que te toca en promedio por pedido, últimos 30 días")}</th>
                    <th className="hide-md">14 días</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const ops = opportunities(s, typical[s.account_id], money(s));
                    const dr = deliveryRate(s);
                    return (
                      <tr key={`${s.account_id}:${s.store_id}`}>
                        <td>
                          <Link className="strong store-name" href={ordersHref(s)}>{s.name}</Link>
                          <div className="sub">
                            {lastSale(s)}
                            {dr !== null && <> · entrega {Math.round(dr * 100)}%</>}
                            {showAccount && <> · {s.account_name}</>}
                          </div>
                          <Ops ops={ops} />
                        </td>
                        <td className="num">{fmtInt(s.today)}</td>
                        <td className="num strong">{fmtInt(s.d7)}</td>
                        <td className="num">{(s.d7 / 7).toFixed(1)}</td>
                        <td className="num"><Delta s={s} /></td>
                        <td className="num"><Constancy n={s.active7} /></td>
                        <td className="num">{s.ticket === null ? "—" : fmtMoney(s.ticket, s.currency)}</td>
                        <td className="num hide-lg">{s.units_per_order?.toFixed(2) ?? "—"}</td>
                        <td className="num hide-lg">{s.vendor_per_order === null ? "—" : fmtMoney(s.vendor_per_order, s.currency)}</td>
                        <td className="hide-md"><Spark days={s.daily} /></td>
                        <td><HealthPill h={health.get(s)!} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      <p className="footnote">
        Sin órdenes canceladas ni rechazadas. Ticket, unidades y &ldquo;te toca&rdquo; son promedios de los últimos 30 días; el ticket bajo se compara con la
        mediana de las tiendas de la misma cuenta.
      </p>
    </div>
  );
}

function lastSale(s: StoreRow) {
  const d = s.days_since;
  if (d === null) return "Sin ventas";
  if (d === 0) return "Última venta hoy";
  if (d === 1) return "Última venta ayer";
  return `Sin vender hace ${d} días`;
}

function HealthPill({ h }: { h: Health }) {
  return <span className="pill" data-tone={HEALTH[h].tone} title={HEALTH[h].hint}>{HEALTH[h].label}</span>;
}

function Delta({ s }: { s: StoreRow }) {
  const c = change(s);
  if (c === null) return <span className="subtle">{s.d7 > 0 ? "nueva" : "—"}</span>;
  const pct = Math.round(c * 100);
  const tone = pct > 15 ? "up" : pct < -15 ? "down" : "flat";
  return <span className="delta" data-tone={tone}>{pct > 0 ? "↑" : pct < 0 ? "↓" : ""} {Math.abs(pct)}%</span>;
}

function Constancy({ n }: { n: number }) {
  return (
    <span className="constancy" title={`${n} de 7 días con pedidos`}>
      <span className="bars" aria-hidden>
        {Array.from({ length: 7 }, (_, i) => <i key={i} data-on={i < n || undefined} />)}
      </span>
      {n}/7
    </span>
  );
}

/** Mini gráfica de pedidos por día (14 días; la última barra es hoy). */
function Spark({ days }: { days: number[] }) {
  const max = Math.max(1, ...days);
  const n = days.length || 1;
  return (
    <svg className="spark" viewBox={`0 0 ${n * 6} 24`} preserveAspectRatio="none" role="img" aria-label={`Pedidos por día, últimos 14 días: ${days.join(", ")}`}>
      {days.map((v, i) => (
        <rect key={i} x={i * 6 + 1} y={24 - Math.max(v ? 2 : 1, (v / max) * 24)} width={4} height={Math.max(v ? 2 : 1, (v / max) * 24)} data-today={i === n - 1 || undefined} data-zero={v === 0 || undefined} />
      ))}
    </svg>
  );
}

function Ops({ ops }: { ops: Opportunity[] }) {
  if (!ops.length) return null;
  return (
    <ul className="ops">
      {ops.map((o) => (
        <li key={o.kind} data-kind={o.kind} title={o.action}>
          {o.text} <span>→ {o.action}</span>
        </li>
      ))}
    </ul>
  );
}
