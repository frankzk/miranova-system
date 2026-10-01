import Link from "next/link";
import { AccountChips } from "@/components/account-chips";
import { ColumnFilter, type FilterOption } from "@/components/column-filter";
import { GetForm } from "@/components/client";
import { ContactQuick } from "@/components/contact-quick";
import { IconChat, IconDownload } from "@/components/icons";
import { StoreDrawerLink } from "@/components/store-drawer-link";
import { StoreSearch, type StoreOption } from "@/components/store-search";
import { PageHead } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { requirePermission } from "@/lib/auth";
import { contactIndex, contactKey, storeProfiles } from "@/lib/contacts";
import { followupIndex } from "@/lib/followups";
import { fmtInt, fmtMoney, todayIn } from "@/lib/format";
import { can } from "@/lib/permissions";
import { storeHealthRecent } from "@/lib/queries";
import { getScope } from "@/lib/scope";
import { daysBetween, fmtDay } from "@/lib/store-metrics";
import {
  change, classify, deliveryRate, filterStores, HEALTH, HEALTH_ORDER, opportunities, sortStores, STORE_SORTS, storeKey, toContact, typicalTickets,
  type Health, type Opportunity, type StoreRow, type StoreSort,
} from "@/lib/stores";
import { StoresSubnav } from "@/components/stores-subnav";
import { loadDrawer, parseFicha, StoreDrawerSlot } from "./store-drawer-panel";

export const metadata = { title: "Salud de tiendas" };

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};
const many = (sp: SP, k: string) => {
  const v = sp[k];
  return [...new Set((Array.isArray(v) ? v : v ? [v] : []).map((x) => x.trim()).filter(Boolean))];
};

export default async function StoresPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("stores");
  const canEdit = can(user, "stores_edit");
  const sp = await searchParams;
  const accounts = await listAccounts();
  const scope = await getScope(accounts);
  // panel lateral de una tienda (?ficha=): contacto e historial de seguimiento sin salir del listado
  const ficha = parseFicha(one(sp, "ficha"));
  // los datos del panel se piden ya, en paralelo con la lista, y se muestran con Suspense
  const drawerData = loadDrawer(ficha);
  // el correo detectado del panel (~0.5 s) queda en memoria desde ya, antes del primer clic
  storeProfiles().catch(() => {});
  const [all, contacts, followups] = await Promise.all([storeHealthRecent(scope.account), contactIndex(), followupIndex()]);
  const groupOf = (s: StoreRow) => contacts.get(contactKey(s))?.group ?? null;

  const hParam = one(sp, "h");
  const h = hParam && hParam in HEALTH ? (hParam as Health) : undefined;
  const sParam = one(sp, "sort");
  const sort: StoreSort = sParam && sParam in STORE_SORTS ? (sParam as StoreSort) : "d7_desc";
  // filtro por grupo de WhatsApp registrado (con / sin)
  const gParam = one(sp, "g");
  const g = gParam === "con" || gParam === "sin" ? gParam : undefined;
  const byGroup = (s: StoreRow) => !g || (g === "con") === !!groupOf(s);
  // buscador: tiendas elegidas de la lista (t) y texto (q); también cambia los conteos de pestañas y de grupo
  const q = one(sp, "q")?.slice(0, 80);
  const picked = many(sp, "t").slice(0, 50);
  const searching = !!q || picked.length > 0;
  const found = filterStores(all, { keys: picked, q });
  const withGroup = found.filter((s) => groupOf(s)).length;

  const health = new Map(all.map((s) => [s, classify(s)]));
  const pool = found.filter(byGroup);
  const counts = Object.fromEntries(HEALTH_ORDER.map((k) => [k, pool.filter((s) => health.get(s) === k).length]));
  const rows = sortStores(pool.filter((s) => !h || health.get(s) === h), sort);
  const typical = typicalTickets(all);
  const money = (s: StoreRow) => (n: number) => fmtMoney(n, s.currency, { compact: true });
  const contact = toContact(all);
  const showAccount = !scope.account && accounts.length > 1;
  // sugerencias del buscador: todas las tiendas de la vista, las que más venden primero
  const options: StoreOption[] = sortStores(all, "d7_desc").map((s) => ({
    key: storeKey(s),
    name: s.name,
    account: showAccount ? s.account_name : null,
    d7: s.d7,
  }));

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q, h, g, sort: sort === "d7_desc" ? undefined : sort, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v && k !== "t") p.set(k, v);
    // las tiendas elegidas se conservan salvo que el cambio las quite ({ t: undefined })
    if (!("t" in patch)) for (const k of picked) p.append("t", k);
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
  // la ficha de la tienda (historial, productos, seguimiento); sus pedidos se abren desde ahí
  // el nombre de la tienda abre su panel lateral (contacto y seguimiento); la ficha completa se abre desde ahí
  const fichaHref = (s: StoreRow) => href({ ficha: storeKey(s) });
  const fichaRow = ficha ? all.find((s) => s.account_id === ficha.accountId && s.store_id === ficha.storeId) ?? null : null;
  const today = todayIn(scope.tz);
  const followupNote = (s: StoreRow) => {
    const f = followups.get(contactKey(s));
    if (!f) return null;
    const overdue = f.next && f.next < today;
    return (
      <span className="fu-note" data-overdue={overdue || undefined} title={`${f.count} ${f.count === 1 ? "registro" : "registros"} de seguimiento`}>
        Seguimiento {fmtDay(f.last, today)}{f.lastOwner && <> · {f.lastOwner}</>}
        {f.next && <> · próximo {overdue ? `vencido hace ${daysBetween(f.next, today)} d` : fmtDay(f.next, today)}</>}
      </span>
    );
  };

  return (
    <div className="page">
      <PageHead
        title="Salud de tiendas"
        sub={<>{fmtInt(all.length)} tiendas con pedidos en 60 días · {scope.label} · ritmo de los últimos 7 días vs. los 7 anteriores</>}
        actions={
          <nav className="segmented" aria-label="Grupo de WhatsApp">
            <Link href={href({ g: undefined })} aria-current={!g}>Todas</Link>
            <Link href={href({ g: "con" })} aria-current={g === "con"} title="Tiendas con grupo de WhatsApp registrado">
              Con grupo <span className="c">{fmtInt(withGroup)}</span>
            </Link>
            <Link href={href({ g: "sin" })} aria-current={g === "sin"} title="Tiendas sin grupo de WhatsApp registrado">
              Sin grupo <span className="c">{fmtInt(found.length - withGroup)}</span>
            </Link>
          </nav>
        }
      />

      <StoresSubnav />
      <AccountChips accounts={accounts} current={scope.account} next={href({})} />

      <GetForm className="toolbar" role="search" action="/stores">
        {h && <input type="hidden" name="h" value={h} />}
        {g && <input type="hidden" name="g" value={g} />}
        {sort !== "d7_desc" && <input type="hidden" name="sort" value={sort} />}
        {/* key: al cambiar la búsqueda en la URL (Limpiar, pestañas) el buscador vuelve a empezar desde ella */}
        <StoreSearch key={`${picked.join("|")}§${q ?? ""}`} options={options} selected={picked} q={q} />
        <button className="btn" type="submit">Buscar</button>
        {searching && <Link className="btn btn-ghost" href={href({ q: undefined, t: undefined })}>Limpiar</Link>}
        {can(user, "export") && (
          <>
            <span className="spacer" />
            {/* el mismo listado (filtros y orden) con el contacto y el seguimiento de cada tienda */}
            <a className="btn" href={`/api/export/stores${qs({}) ? `?${qs({})}` : ""}`} download title="Descargar este listado en Excel, con los datos de contacto">
              <IconDownload /> Exportar a Excel
            </a>
          </>
        )}
      </GetForm>

      {contact.length > 0 && !h && !g && !searching && (
        <section className="panel contact-today">
          <div className="panel-head">
            <h2>Contactar hoy</h2>
            <span className="aside">Las que más pedidos dejaron de hacer esta semana</span>
          </div>
          <ul className="list-rows panel-flush">
            {contact.map((s) => {
              const ops = opportunities(s, typical[s.account_id], money(s));
              return (
                <li key={`${s.account_id}:${s.store_id}`} className="row-qc">
                  <StoreDrawerLink href={fichaHref(s)} name={s.name}>
                    <span className="t">{s.name}</span>
                    <HealthPill h={health.get(s)!} />
                    <span className="s">
                      {fmtInt(s.prev7)} → {fmtInt(s.d7)} pedidos · {lastSale(s)}
                      {showAccount && <> · {s.account_name}</>}
                    </span>
                    <span className="s reason">{ops[0] ? `${ops[0].text} → ${ops[0].action}` : ""}</span>
                  </StoreDrawerLink>
                  <ContactQuick c={contacts.get(contactKey(s))} storeHref={fichaHref(s)} name={s.name} canEdit={canEdit} />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <nav className="tabs" aria-label="Filtrar por estado">
        <Link href={href({ h: undefined })} aria-current={!h}>
          Todas <span className="c">{fmtInt(pool.length)}</span>
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
            <h3>{all.length === 0 ? "Aún no hay tiendas" : searching && pool.length === 0 ? (q ? `Ninguna tienda coincide con “${q}”` : "Ninguna de las tiendas elegidas en esta vista") : "Ninguna tienda en este estado"}</h3>
            <p>
              {all.length === 0
                ? "Cuando lleguen órdenes con dropshipper en los últimos 60 días, aparecerán aquí."
                : searching && pool.length === 0
                  ? q
                    ? "Revisa el nombre o busca solo una parte (por ejemplo, la primera palabra)."
                    : "Puede que sean de otra cuenta o que no tengan pedidos en 60 días."
                  : "Prueba con otra pestaña."}
            </p>
          </div>
        ) : (
          <>
            <ul className="store-cards only-sm">
              {rows.map((s) => (
                <li key={`${s.account_id}:${s.store_id}`}>
                  <div className="top">
                    <StoreDrawerLink className="strong" href={fichaHref(s)} name={s.name}>{s.name}</StoreDrawerLink>
                    <GroupLink url={groupOf(s)} />
                    <HealthPill h={health.get(s)!} />
                  </div>
                  <div className="sub">{lastSale(s)}{showAccount && <> · {s.account_name}</>}</div>
                  {followupNote(s)}
                  <Spark days={s.daily} />
                  <dl>
                    <div><dt>Hoy</dt><dd>{fmtInt(s.today)}</dd></div>
                    <div><dt>7 días</dt><dd>{fmtInt(s.d7)}</dd></div>
                    <div><dt>Ritmo/día</dt><dd>{(s.d7 / 7).toFixed(1)}</dd></div>
                    <div><dt>Variación</dt><dd><Delta s={s} /></dd></div>
                    <div><dt>Días activos</dt><dd>{s.active7}/7</dd></div>
                    <div><dt>Ticket</dt><dd>{s.ticket === null ? "—" : fmtMoney(s.ticket, s.currency)}</dd></div>
                    <div><dt>Unid./ped.</dt><dd>{s.units_per_order?.toFixed(2) ?? "—"}</dd></div>
                    <div><dt>Productos</dt><dd>{fmtInt(s.skus30)}</dd></div>
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
                    <th className="r hide-lg">{sortCol("Productos", ["skus_desc", "skus_asc"], "right", "Productos distintos con pedidos en 30 días")}</th>
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
                          <StoreDrawerLink className="strong store-name" href={fichaHref(s)} name={s.name}>{s.name}</StoreDrawerLink>
                          <GroupLink url={groupOf(s)} />
                          <div className="sub">
                            {lastSale(s)}
                            {dr !== null && <> · entrega {Math.round(dr * 100)}%</>}
                            {showAccount && <> · {s.account_name}</>}
                          </div>
                          {followupNote(s)}
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
                        <td className="num hide-lg" title={s.top_product ? `Principal: ${s.top_product} (${Math.round((s.top_share ?? 0) * 100)}% de sus pedidos)` : undefined}>
                          {fmtInt(s.skus30)}
                        </td>
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
      {ficha && drawerData && (
        <StoreDrawerSlot
          ficha={ficha}
          data={drawerData}
          row={fichaRow}
          typical={fichaRow ? typical[fichaRow.account_id] : null}
          closeHref={href({})}
          me={user.name}
          canOrders={can(user, "orders")}
          canEdit={canEdit}
        />
      )}

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

/** Acceso directo al grupo de WhatsApp de la tienda, si está registrado. */
function GroupLink({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <a className="wa-link" href={url} target="_blank" rel="noopener noreferrer" title="Abrir grupo de WhatsApp" aria-label="Abrir grupo de WhatsApp">
      <IconChat />
    </a>
  );
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
