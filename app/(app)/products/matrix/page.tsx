import Link from "next/link";
import { AccountChips } from "@/components/account-chips";
import { AutoSelect, GetForm } from "@/components/client";
import { IconDownload, IconSearch } from "@/components/icons";
import { ProductsSubnav } from "@/components/products-subnav";
import { StoreDrawerLink } from "@/components/store-drawer-link";
import { PageHead } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { requirePermission } from "@/lib/auth";
import { storeProfiles } from "@/lib/contacts";
import { crossSell, type CrossSellItem } from "@/lib/cross-sell";
import { fmtInt, fmtMoney } from "@/lib/format";
import { can } from "@/lib/permissions";
import { getScope } from "@/lib/scope";
import {
  COMPARE_RULES, compareRows, isSort, isTrend, MOVE_LABEL, pctChange, periodStartIso, productFocus, SORTS, sortRows, storeHabits, trendCounts,
  trendInfo, TRENDS, type CmpProduct, type CmpRow, type Habits, type ProductFocus, type SortId, type Trend,
} from "@/lib/store-compare";
import { MATRIX_DAYS, storeProductCompare } from "@/lib/store-product-matrix";
import { storeKey } from "@/lib/stores";
import { loadDrawer, parseFicha, StoreDrawerSlot } from "../../stores/store-drawer-panel";
import "./matrix.css";

export const metadata = { title: "Tienda × producto" };

type SP = Record<string, string | string[] | undefined>;
const PATH = "/products/matrix";
const IDEAS = 8;
const one = (sp: SP, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};
const pace = (n: number, days: number) => {
  const x = n / Math.max(1, days);
  return x >= 10 ? String(Math.round(x)) : x > 0 && x < 0.1 ? "<0.1" : x.toFixed(1);
};
const shortDay = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("es-HN", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`)).replace(/\./g, "") : "—";

function Delta({ change, title }: { change: number | null; title?: string }) {
  if (change === null) return null;
  const p = Math.round(change * 100);
  return (
    <span className="delta" data-tone={p >= 1 ? "up" : p <= -1 ? "down" : "flat"} title={title}>
      {p > 0 ? "↑" : p < 0 ? "↓" : ""} {Math.abs(p)}%
    </span>
  );
}

export default async function StoreProductMatrixPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [user, accounts, sp] = await Promise.all([requirePermission("products"), listAccounts(), searchParams]);
  // sin permiso de Tiendas, los nombres de tienda van sin enlace a su panel
  const canStores = can(user, "stores");
  const raw = Number(one(sp, "days"));
  const days = (MATRIX_DAYS as readonly number[]).includes(raw) ? raw : 30;
  const trendParam = one(sp, "t");
  const trend: Trend | undefined = isTrend(trendParam) ? trendParam : undefined;
  const sortParam = one(sp, "o");
  // al filtrar por estado, el orden que más sirve: las que más bajan o las que más suben primero
  const sort: SortId = isSort(sortParam) ? sortParam : trend === "falling" || trend === "stopped" ? "caida" : trend === "growing" || trend === "back" ? "subida" : "pedidos";
  const q = one(sp, "q")?.slice(0, 80);
  const pParam = one(sp, "p");
  const scope = await getScope(accounts);
  const ficha = canStores ? parseFicha(one(sp, "ficha")) : null;
  const drawerData = loadDrawer(ficha);
  const [data, profiles] = await Promise.all([
    storeProductCompare(scope.account, days),
    storeProfiles().catch((e) => (console.error("tienda × producto: perfiles", e), [])),
  ]);
  const firstAt = new Map(profiles.map((p) => [`${p.account_id}|${p.store_id}`, p.first_at]));
  const filter = { periodStart: periodStartIso(days), firstAt };
  const focusAcc = pParam?.slice(0, 36);
  const focusKey = pParam?.slice(37);
  const focus = focusAcc && focusKey ? productFocus(data, focusAcc, focusKey) : null;

  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | undefined> = {
      days: days === 30 ? undefined : String(days), t: trend, q, p: focus ? pParam : undefined, o: isSort(sortParam) ? sortParam : undefined,
    };
    for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `${PATH}?${s}` : PATH;
  };
  const fichaHref = (r: { account_id: string; store_id: string }) => href({ ficha: storeKey(r) });

  const sections = data.accounts
    .filter((a) => !focus || a.account_id === focus.product.account_id)
    .map((a) => {
      const base = compareRows(data, a.account_id, { ...filter, q, product: focus?.product.account_id === a.account_id ? focus.product.product_key : undefined });
      return { account: a, products: base.products, all: base.rows, rows: sortRows(trend ? base.rows.filter((r) => r.trend === trend) : base.rows, sort) };
    })
    .filter((s) => s.all.length > 0);
  const allRows = sections.flatMap((s) => s.all);
  const counts = trendCounts(allRows);
  const shown = sections.reduce((t, s) => t + s.rows.length, 0);
  const showAccount = data.accounts.length > 1;
  const accountName = new Map(data.accounts.map((a) => [a.account_id, a.account_name]));
  const ideas = crossSell(data);
  const productOptions = data.products
    .filter((p) => p.orders + p.orders_prev > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "es"))
    .map((p) => ({ value: `${p.account_id}|${p.product_key}`, label: showAccount ? `${p.name} · ${accountName.get(p.account_id) ?? ""}` : p.name }));

  const fichaRow = ficha ? data.stores.find((s) => s.account_id === ficha.accountId && s.store_id === ficha.storeId) : undefined;
  const habits = ficha ? storeHabits(data, ficha.accountId, ficha.storeId, filter) : null;
  const currency = (accountId: string) => data.accounts.find((a) => a.account_id === accountId)?.currency ?? "HNL";

  return (
    <div className="page mx-page">
      <PageHead
        title="Tienda × producto"
        sub={<>Pedidos de cada tienda en cada producto · últimos {days} días comparados con los {days} anteriores · {scope.label}</>}
        actions={
          <>
            <nav className="segmented" aria-label="Período">
              {MATRIX_DAYS.map((d) => (
                <Link key={d} href={href({ days: d === 30 ? undefined : String(d) })} aria-current={d === days}>{d} días</Link>
              ))}
            </nav>
            {can(user, "export") && (
              <a className="btn" href={`/api/export/store-products?days=${days}`} download title="Todas las tiendas y productos de la cuenta elegida en este período, con el período anterior">
                <IconDownload /> Excel
              </a>
            )}
          </>
        }
      />

      <ProductsSubnav />

      <AccountChips accounts={accounts} current={scope.account} next={href({ p: undefined })} />

      <nav className="chips mx-trends" aria-label="Filtrar por cómo van las tiendas">
        <Link href={href({ t: undefined })} aria-current={!trend}>Todas <span className="c">{fmtInt(allRows.length)}</span></Link>
        {TRENDS.map((t) => (
          <Link key={t.id} href={href({ t: t.id })} aria-current={trend === t.id} title={t.hint} data-tone={t.tone}>
            <span className="dot" data-tone={t.tone} aria-hidden />
            {t.label} <span className="c">{fmtInt(counts[t.id])}</span>
          </Link>
        ))}
      </nav>

      <GetForm className="mx-filters" action={PATH} role="search">
        {days !== 30 && <input type="hidden" name="days" value={days} />}
        {trend && <input type="hidden" name="t" value={trend} />}
        <label className="input-icon mx-q">
          <IconSearch />
          <input className="input" type="search" name="q" defaultValue={q} placeholder="Buscar tienda" aria-label="Buscar tienda" />
        </label>
        <AutoSelect name="p" defaultValue={focus ? pParam : ""} aria-label="Ver un producto">
          <option value="">Todos los productos</option>
          {productOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </AutoSelect>
        <AutoSelect name="o" defaultValue={isSort(sortParam) ? sortParam : ""} aria-label="Ordenar">
          <option value="">Orden: {SORTS.find((s) => s.id === sort)?.label.toLowerCase()}</option>
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </AutoSelect>
        {(q || focus || isSort(sortParam)) && <Link className="btn btn-ghost" href={href({ q: undefined, p: undefined, o: undefined })}>Limpiar</Link>}
      </GetForm>

      {focus && <Focus f={focus} days={days} account={showAccount ? accountName.get(focus.product.account_id) : undefined} fichaHref={canStores ? fichaHref : null} clearHref={href({ p: undefined })} />}

      {shown === 0 ? (
        <div className="table-wrap">
          <div className="empty">
            <h3>{allRows.length ? "Ninguna tienda con este filtro" : `Sin pedidos en los últimos ${days * 2} días`}</h3>
            <p>{allRows.length ? "Prueba con otro estado, otra búsqueda u otro producto." : "Cuando las tiendas tengan pedidos, aquí verás qué productos vende cada una y cómo cambian."}</p>
            {allRows.length > 0 && <Link className="btn" href={href({ t: undefined, q: undefined, p: undefined })}>Ver todas</Link>}
          </div>
        </div>
      ) : (
        sections.filter((s) => s.rows.length > 0).map((s) => {
          const now = s.all.reduce((t, r) => t + r.store.orders, 0);
          const before = s.all.reduce((t, r) => t + r.store.orders_prev, 0);
          return (
            <section key={s.account.account_id} className="mx-section">
              <h2 className="band-label mx-band">
                {s.account.account_name}
                <span>
                  {fmtInt(s.rows.length)} {s.rows.length === 1 ? "tienda" : "tiendas"}{s.rows.length !== s.all.length && <> de {fmtInt(s.all.length)}</>}
                  {" "}· {fmtInt(now)} pedidos (antes {fmtInt(before)}) <Delta change={pctChange(now, before)} />
                </span>
              </h2>
              <Table products={s.products} rows={s.rows} days={days} fichaHref={canStores ? fichaHref : null} productHref={(p) => href({ p: `${p.account_id}|${p.product_key}` })} focusKey={focus?.product.product_key} />
            </section>
          );
        })
      )}

      <section className="panel mx-ideas">
        <div className="panel-head">
          <h2>Venta cruzada</h2>
          <span className="aside">Productos que una tienda fuerte nunca probó (90 días) y sus pares sí venden</span>
        </div>
        {ideas.length === 0 ? (
          <p className="mx-empty">Sin sugerencias por ahora. Al abrir cada tienda verás qué ofrecerle según lo que venden sus pares.</p>
        ) : (
          <ul className="mx-list">
            {ideas.slice(0, IDEAS).map((i) => (
              <Idea key={`${i.kind}:${i.account_id}:${i.store_id}:${i.product_key}`} i={i} account={showAccount ? accountName.get(i.account_id) : undefined} href={canStores ? fichaHref(i) : null} />
            ))}
          </ul>
        )}
        {ideas.length > IDEAS && <p className="mx-more">y {ideas.length - IDEAS} sugerencias más</p>}
      </section>

      <p className="footnote">
        Cada celda son los pedidos de la tienda que incluyen el producto en los últimos {days} días; abajo, el cambio contra los {days} días
        anteriores (“antes”). Sin cancelados ni rechazados. Bajando o creciendo: un cambio de {COMPARE_RULES.change * 100}% o más con al menos{" "}
        {COMPARE_RULES.minBase} pedidos en alguno de los dos períodos. Se frenó: {COMPARE_RULES.stoppedMin} o más pedidos antes y ninguno ahora.
        Nueva: su primer pedido con Miranova fue en el período. 🔥 marca el producto del que depende la tienda (la mitad o más de sus pedidos).
        Abre una tienda para ver sus hábitos, qué dejó de pedir, qué ofrecerle y registrar el seguimiento.
      </p>

      {ficha && drawerData && (
        <StoreDrawerSlot
          ficha={ficha}
          data={drawerData}
          name={fichaRow?.name}
          closeHref={href({})}
          me={user.name}
          canOrders={can(user, "orders")}
          canEdit={can(user, "stores_edit")}
          extra={habits ? <HabitsSection h={habits} days={days} currency={currency(habits.store.account_id)} /> : null}
        />
      )}
    </div>
  );
}

function StoreName({ s, fichaHref }: { s: { account_id: string; store_id: string; name: string }; fichaHref: ((r: { account_id: string; store_id: string }) => string) | null }) {
  return fichaHref
    ? <StoreDrawerLink className="strong" href={fichaHref(s)} name={s.name} title={s.name}>{s.name}</StoreDrawerLink>
    : <span className="strong" title={s.name}>{s.name}</span>;
}

function Table({ products, rows, days, fichaHref, productHref, focusKey }: {
  products: CmpProduct[];
  rows: CmpRow[];
  days: number;
  fichaHref: ((r: { account_id: string; store_id: string }) => string) | null;
  productHref: (p: CmpProduct) => string;
  focusKey?: string;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => r.cells.map((c) => c.n)));
  return (
    <div className="table-wrap">
      <div className="mx-scroll" tabIndex={0} aria-label="Tienda × producto (desliza para ver más productos)">
        <table className="table mx-table">
          <thead>
            <tr>
              <th className="mx-store">Tienda</th>
              <th className="r" title={`Pedidos de la tienda en ${days} días y en los ${days} anteriores`}>Pedidos</th>
              <th className="r">Cambio</th>
              <th className="r" title="Productos distintos con pedidos en el período">SKUs</th>
              {products.map((p) => (
                <th key={p.product_key} className="mx-prod" data-focus={p.product_key === focusKey || undefined} title={`${p.name} · ${p.orders} pedidos (antes ${p.orders_prev}) · ${p.stores} tiendas (antes ${p.stores_prev})`}>
                  <Link className="mx-pname" href={productHref(p)}>{p.name}</Link>
                  <span className="mx-ptotal">{fmtInt(p.orders)} <span className="mx-was">· antes {fmtInt(p.orders_prev)}</span></span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const t = trendInfo(r.trend);
              const s = r.store;
              return (
                <tr key={s.store_id} data-trend={r.trend}>
                  <th scope="row" className="mx-store">
                    <StoreName s={s} fichaHref={fichaHref} />
                    <span className="sub">
                      <span className="mx-tag" data-tone={t.tone} title={t.hint}>{t.label}</span> · {pace(s.orders, days)}/día
                      {s.fu_at && <span title={`Último seguimiento: ${shortDay(s.fu_at)}`}> · 📞 {shortDay(s.fu_at)}</span>}
                    </span>
                  </th>
                  <td className="num">
                    <span className="strong">{fmtInt(s.orders)}</span>
                    <span className="mx-was">antes {fmtInt(s.orders_prev)}</span>
                  </td>
                  <td className="num">
                    {r.change !== null ? <Delta change={r.change} /> : s.orders > 0 ? <span className="mx-move" data-move="new">nueva o volvió</span> : <span className="subtle">—</span>}
                    {r.delta !== 0 && <span className="mx-was">{r.delta > 0 ? "+" : "−"}{fmtInt(Math.abs(r.delta))}</span>}
                  </td>
                  <td className="num">
                    {fmtInt(s.skus)}
                    {s.skus_prev !== s.skus && <span className="mx-was">antes {fmtInt(s.skus_prev)}</span>}
                  </td>
                  {r.cells.map((c, i) => {
                    const dom = r.dominant && r.top === i;
                    const p = products[i];
                    const move = c.n === 0 && c.p === 0 ? null : c.p === 0 ? "new" : c.n === 0 ? "dropped" : c.n > c.p ? "up" : c.n < c.p ? "down" : "same";
                    return (
                      <td
                        key={p.product_key}
                        className="num mx-cell"
                        data-zero={c.n === 0 || undefined}
                        data-move={move ?? undefined}
                        data-top={r.top === i || undefined}
                        data-dom={dom || undefined}
                        data-focus={p.product_key === focusKey || undefined}
                        style={c.n > 0 && !dom ? { ["--mx-a" as string]: (0.04 + 0.22 * (c.n / max)).toFixed(3) } : undefined}
                        title={`${s.name} · ${p.name}: ${c.n} pedidos en ${days} días · antes ${c.p}${dom ? ` · ${Math.round((c.n / Math.max(1, s.orders)) * 100)}% de la tienda` : ""}`}
                      >
                        {move === null ? "·" : (
                          <>
                            <span className="mx-n">{dom && "🔥 "}{fmtInt(c.n)}</span>
                            <span className="mx-move" data-move={move}>
                              {move === "new" ? "nuevo" : move === "dropped" ? `antes ${fmtInt(c.p)}` : move === "same" ? "=" : `${c.n > c.p ? "+" : "−"}${fmtInt(Math.abs(c.n - c.p))}`}
                            </span>
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Un producto: tiendas que lo dejaron, bajaron, subieron o lo empezaron. */
function Focus({ f, days, account, fichaHref, clearHref }: {
  f: ProductFocus;
  days: number;
  account?: string;
  fichaHref: ((r: { account_id: string; store_id: string }) => string) | null;
  clearHref: string;
}) {
  const p = f.product;
  const cols: { title: string; tone: string; items: { key: string; s: { account_id: string; store_id: string; name: string }; text: string }[]; empty: string }[] = [
    { title: "Lo dejaron de pedir", tone: "danger", empty: "Ninguna", items: f.dropped.map((x) => ({ key: x.store.store_id, s: x.store, text: `antes ${x.p} · último ${shortDay(x.last_at)}` })) },
    { title: "Bajaron", tone: "warning", empty: "Ninguna", items: f.down.map((x) => ({ key: x.store.store_id, s: x.store, text: `${x.n} (antes ${x.p})` })) },
    { title: "Subieron", tone: "success", empty: "Ninguna", items: f.up.map((x) => ({ key: x.store.store_id, s: x.store, text: `${x.n} (antes ${x.p})` })) },
    { title: "Lo empezaron", tone: "info", empty: "Ninguna", items: f.started.map((x) => ({ key: x.store.store_id, s: x.store, text: `${x.n} ${x.n === 1 ? "pedido" : "pedidos"}` })) },
  ];
  return (
    <section className="panel mx-focus" aria-labelledby="mx-focus-h">
      <div className="panel-head">
        <h2 id="mx-focus-h">{p.name}</h2>
        <Link className="btn btn-ghost btn-sm" href={clearHref}>Quitar producto</Link>
      </div>
      <p className="mx-focus-sum">
        {account && <>{account} · </>}
        <b>{fmtInt(p.orders)}</b> pedidos en {days} días (antes {fmtInt(p.orders_prev)}) <Delta change={pctChange(p.orders, p.orders_prev)} />
        {" "}· <b>{fmtInt(p.stores)}</b> tiendas lo venden (antes {fmtInt(p.stores_prev)})
      </p>
      <div className="mx-focus-cols">
        {cols.map((c) => (
          <div key={c.title}>
            <h3 data-tone={c.tone}>{c.title} <span className="c">{fmtInt(c.items.length)}</span></h3>
            {c.items.length === 0 ? <p className="subtle">{c.empty}</p> : (
              <ul>
                {c.items.slice(0, 8).map((x) => (
                  <li key={x.key}><StoreName s={x.s} fichaHref={fichaHref} /><span className="sub">{x.text}</span></li>
                ))}
                {c.items.length > 8 && <li className="subtle">y {c.items.length - 8} más (están en la tabla)</li>}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Panel de la tienda: hábitos de compra, qué dejó de pedir, qué ofrecerle y el efecto del último contacto. */
function HabitsSection({ h, days, currency }: { h: Habits; days: number; currency: string }) {
  const s = h.store;
  const t = trendInfo(h.trend);
  return (
    <div className="section mx-habits">
      <h3>Hábitos de compra <span className="aside">últimos {days} días vs. los {days} anteriores</span></h3>
      <p className="mx-hab-trend"><span className="mx-tag" data-tone={t.tone}>{t.label}</span> {t.hint.toLowerCase()}.</p>
      <dl className="mx-hab-kpis">
        <div><dt>Pedidos</dt><dd>{fmtInt(s.orders)} <span className="mx-was">antes {fmtInt(s.orders_prev)}</span> <Delta change={h.change} /></dd></div>
        <div><dt>Ritmo</dt><dd>{pace(s.orders, days)}/día <span className="mx-was">antes {pace(s.orders_prev, days)}</span></dd></div>
        <div><dt>Días con pedidos</dt><dd>{fmtInt(h.activeDays)} de {days}</dd></div>
        <div><dt>Unidades por pedido</dt><dd>{h.unitsPerOrder === null ? "—" : h.unitsPerOrder.toFixed(2)}</dd></div>
        <div><dt>Ticket</dt><dd>{h.ticket === null ? "—" : fmtMoney(h.ticket, currency)}</dd></div>
        <div><dt>Último pedido</dt><dd>{h.daysSince === null ? "—" : h.daysSince === 0 ? "hoy" : `hace ${h.daysSince} ${h.daysSince === 1 ? "día" : "días"}`}</dd></div>
      </dl>

      {h.products.length > 0 && (
        <>
          <h4>Lo que pide</h4>
          <ul className="mx-hab-list">
            {h.products.map((p) => (
              <li key={p.product_key}>
                <span className="n">{p.name}</span>
                <span className="v">{fmtInt(p.n)} <span className="mx-was">antes {fmtInt(p.p)}</span></span>
                <span className="mx-move" data-move={p.move}>{MOVE_LABEL[p.move]}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {h.dropped.length > 0 && (
        <p className="mx-hab-alert">
          <b>Dejó de pedir:</b> {h.dropped.map((d) => `${d.name} (antes ${d.p}, último ${shortDay(d.last_at)})`).join(" · ")}. Pregúntale qué pasó: stock, precio o pauta.
        </p>
      )}

      {h.offer.length > 0 && (
        <>
          <h4>Qué ofrecerle</h4>
          <ul className="mx-hab-offer">
            {h.offer.map((o) => (
              <li key={o.product_key}><span className="n">{o.name}</span><span className="sub">{o.reason}</span></li>
            ))}
          </ul>
        </>
      )}

      {h.impact && (
        <p className="mx-hab-impact" data-state={h.impact.ready ? "ready" : "measuring"}>
          <b>Último contacto ({shortDay(h.impact.at)}):</b>{" "}
          {h.impact.ready
            ? <>{fmtInt(h.impact.before)} pedidos en los 7 días antes → {fmtInt(h.impact.after)} en los 7 días desde el contacto <Delta change={h.impact.change} /></>
            : <>midiendo el efecto (faltan {h.impact.daysLeft} {h.impact.daysLeft === 1 ? "día" : "días"}); van {fmtInt(h.impact.after)} pedidos desde el contacto.</>}
        </p>
      )}
    </div>
  );
}

function Idea({ i, account, href }: { i: CrossSellItem; account?: string; href: string | null }) {
  return (
    <li className="mx-idea" data-kind={i.kind}>
      {href ? <StoreDrawerLink className="strong" href={href} name={i.store_name}>{i.title}</StoreDrawerLink> : <span className="strong">{i.title}</span>}
      <p className="detail">{i.detail}{account && <> · {account}</>}</p>
      <p className="action">→ {i.action}</p>
    </li>
  );
}
