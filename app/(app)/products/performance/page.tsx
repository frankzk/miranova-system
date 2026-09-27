import { AccountChips } from "@/components/account-chips";
import { ColumnFilter, type FilterOption } from "@/components/column-filter";
import { IconBox } from "@/components/icons";
import { ProductsSubnav } from "@/components/products-subnav";
import { PageHead } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { requirePermission } from "@/lib/auth";
import { fmtInt, fmtMoney } from "@/lib/format";
import {
  change, LOW_MOVEMENT_CAUSES, perStore, PRODUCT_RULES, PRODUCT_SORTS, productOpportunity, sortProducts, TREND, trend,
  unitsPerOrder, type ProductOpportunity, type ProductPerf, type ProductSort,
} from "@/lib/product-insights";
import { productPerformance } from "@/lib/product-performance";
import { getScope } from "@/lib/scope";
import "./performance.css";

export const metadata = { title: "Rendimiento de productos" };

type SP = Record<string, string | string[] | undefined>;
const PATH = "/products/performance";
const SHOWN = 6;

export default async function ProductPerformancePage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("products");
  const sp = await searchParams;
  const accounts = await listAccounts();
  const scope = await getScope(accounts);
  const all = await productPerformance(scope.account);

  const raw = Array.isArray(sp.sort) ? sp.sort[0] : sp.sort;
  const sort: ProductSort = raw && raw in PRODUCT_SORTS ? (raw as ProductSort) : "orders30_desc";
  const now = Date.now();
  const opp = new Map(all.map((p) => [p, productOpportunity(p, now)]));
  const sold = all.filter((p) => p.orders30 > 0);
  const rows = sortProducts(sold, sort);
  const byPriority = (a: ProductPerf, b: ProductPerf) => opp.get(b)!.priority - opp.get(a)!.priority;
  const expansion = all.filter((p) => ["hot", "expansion"].includes(opp.get(p)?.kind ?? "")).sort(byPriority);
  const low = all.filter((p) => ["low_movement", "no_orders"].includes(opp.get(p)?.kind ?? "")).sort(byPriority);
  const trends = sold.map((p) => trend(p));
  const showAccount = !scope.account && accounts.length > 1;

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { sort: sort === "orders30_desc" ? undefined : sort, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return p.toString();
  };
  const href = (patch: Record<string, string | undefined>) => {
    const s = qs(patch);
    return s ? `${PATH}?${s}` : PATH;
  };
  const sortCol = (label: string, keys: ProductSort[], align: "left" | "right" = "right", title?: string) => (
    <ColumnFilter
      path={PATH}
      label={label}
      param="sort"
      align={align}
      query={qs({ sort: undefined })}
      current={keys.includes(sort) && sort !== "orders30_desc" ? sort : undefined}
      allLabel={PRODUCT_SORTS.orders30_desc}
      options={keys.filter((k) => k !== "orders30_desc").map((k): FilterOption => ({ value: k, label: PRODUCT_SORTS[k] }))}
      title={title}
    />
  );
  const money = (p: ProductPerf) => (p.ticket === null ? "—" : fmtMoney(p.ticket, p.currency));
  const upo = (p: ProductPerf) => unitsPerOrder(p)?.toFixed(2) ?? "—";

  return (
    <div className="page">
      <PageHead
        title="Rendimiento de productos"
        sub={<>{fmtInt(sold.length)} productos con pedidos en 30 días · {scope.label} · tendencia de los últimos 7 días vs. los 7 anteriores</>}
      />

      <ProductsSubnav />

      <AccountChips accounts={accounts} current={scope.account} next={href({})} />

      <div className="metrics">
        <div className="metric">
          <span className="label">Con pedidos</span>
          <span className="value">{fmtInt(sold.length)}</span>
          <span className="foot">productos, últimos 30 días</span>
        </div>
        <div className="metric">
          <span className="label">Creciendo</span>
          <span className="value">{fmtInt(trends.filter((t) => t === "strong" || t === "growing").length)}</span>
          <span className="foot">más de 15% arriba en 7 días</span>
        </div>
        <div className="metric">
          <span className="label">Bajando</span>
          <span className="value">{fmtInt(trends.filter((t) => t === "declining" || t === "falling").length)}</span>
          <span className="foot">más de 15% abajo en 7 días</span>
        </div>
        <div className="metric">
          <span className="label">Activos sin pedidos</span>
          <span className="value">{fmtInt(all.filter((p) => p.orders30 === 0).length)}</span>
          <span className="foot">en el catálogo, 30 días</span>
        </div>
      </div>

      <div className="pp-blocks">
        <section className="panel pp-block" data-tone="up">
          <div className="panel-head">
            <h2>Potencial de expansión</h2>
            <span className="aside">Venden mucho por tienda y pocas tiendas los tienen</span>
          </div>
          {expansion.length === 0 ? (
            <p className="pp-empty">
              Ningún producto con potencial claro ahora. Aparecen aquí los que mueven al menos {PRODUCT_RULES.minPerStoreDay} pedidos/día por tienda y
              los vende menos del {Math.round(PRODUCT_RULES.maxCoverage * 100)}% de tus tiendas activas, o los que crecen más de{" "}
              {Math.round(PRODUCT_RULES.hotChange * 100)}% en la semana.
            </p>
          ) : (
            <ul className="pp-list">
              {expansion.slice(0, SHOWN).map((p) => (
                <Item key={`${p.account_id}:${p.product_key}`} p={p} o={opp.get(p)!} showAccount={showAccount} />
              ))}
            </ul>
          )}
          {expansion.length > SHOWN && <p className="pp-more">y {expansion.length - SHOWN} más en la tabla</p>}
        </section>

        <section className="panel pp-block" data-tone="down">
          <div className="panel-head">
            <h2>Bajo movimiento</h2>
            <span className="aside">Más de {PRODUCT_RULES.minAgeDays} días disponibles y se mueven poco</span>
          </div>
          {low.length === 0 ? (
            <p className="pp-empty">
              Todo se está moviendo. Aparecen aquí los productos con más de {PRODUCT_RULES.minAgeDays} días disponibles y menos de{" "}
              {PRODUCT_RULES.lowPerStoreWeek} pedidos por tienda por semana, y los activos con inventario sin pedidos en 30 días.
            </p>
          ) : (
            <ul className="pp-list">
              {low.slice(0, SHOWN).map((p) => (
                <Item key={`${p.account_id}:${p.product_key}`} p={p} o={opp.get(p)!} showAccount={showAccount} />
              ))}
            </ul>
          )}
          {low.length > SHOWN && <p className="pp-more">y {low.length - SHOWN} más</p>}
          {low.length > 0 && (
            <div className="pp-causes">
              <span className="t">Causas probables</span>
              <ul>
                {LOW_MOVEMENT_CAUSES().map((c) => (
                  <li key={c.key}><b>{c.cause}</b> → {c.action}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty">
            <h3>Aún no hay pedidos de productos</h3>
            <p>Cuando lleguen pedidos en los últimos 30 días, aquí verás cuántas tiendas venden cada producto y cómo va su ritmo.</p>
          </div>
        ) : (
          <>
            <ul className="pp-cards only-sm">
              {rows.map((p) => (
                <li key={`${p.account_id}:${p.product_key}`}>
                  <div className="top">
                    <ProductName p={p} showAccount={showAccount} />
                    <TrendPill p={p} />
                  </div>
                  <Spark days={p.daily} />
                  <dl>
                    <div><dt>7 días</dt><dd>{fmtInt(p.orders7)}</dd></div>
                    <div><dt>30 días</dt><dd>{fmtInt(p.orders30)}</dd></div>
                    <div><dt>Tiendas</dt><dd>{fmtInt(p.stores30)} de {fmtInt(p.active_stores30)}</dd></div>
                    <div><dt>Ped./tienda</dt><dd>{perStore(p).toFixed(1)}</dd></div>
                    <div><dt>Unidades</dt><dd>{fmtInt(p.units30)}</dd></div>
                    <div><dt>Unid./ped.</dt><dd>{upo(p)}</dd></div>
                    <div className="wide"><dt>Ticket</dt><dd>{money(p)}</dd></div>
                  </dl>
                </li>
              ))}
            </ul>

            <div className="table-scroll not-sm">
              <table className="table pp-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="r">{sortCol("7 días", ["orders7_desc"], "right", "Pedidos de las últimas 168 horas")}</th>
                    <th className="r">{sortCol("30 días", ["orders30_desc"], "right", "Pedidos (sin cancelados) que incluyen el producto")}</th>
                    <th className="r hide-lg">{sortCol("Unidades", ["units_desc"], "right", "Unidades vendidas en 30 días")}</th>
                    <th className="r">{sortCol("Tiendas", ["stores_desc", "stores_asc"], "right", "Tiendas que lo venden de las activas de la cuenta (30 días)")}</th>
                    <th className="r">{sortCol("Ped./tienda", ["per_store_desc"], "right", "Pedidos de 30 días por tienda que lo vende")}</th>
                    <th>{sortCol("Tendencia", ["rise", "drop"], "left", "Últimos 7 días vs. los 7 anteriores")}</th>
                    <th className="r">{sortCol("Ticket", ["ticket_desc", "ticket_asc"], "right", "Total promedio de los pedidos que lo incluyen, 30 días")}</th>
                    <th className="r hide-lg">{sortCol("Unid./ped.", ["upo_desc", "upo_asc"], "right", "Unidades por pedido, 30 días")}</th>
                    <th className="hide-md">14 días</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={`${p.account_id}:${p.product_key}`}>
                      <td><ProductName p={p} showAccount={showAccount} flag={opp.get(p)} /></td>
                      <td className="num strong">{fmtInt(p.orders7)}</td>
                      <td className="num">{fmtInt(p.orders30)}</td>
                      <td className="num hide-lg">{fmtInt(p.units30)}</td>
                      <td className="num"><Coverage p={p} /></td>
                      <td className="num">{perStore(p).toFixed(1)}</td>
                      <td><TrendPill p={p} /></td>
                      <td className="num">{money(p)}</td>
                      <td className="num hide-lg">{upo(p)}</td>
                      <td className="hide-md"><Spark days={p.daily} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      <p className="footnote">
        Sin órdenes canceladas ni rechazadas. Un pedido con dos variantes del mismo producto cuenta una vez. Tiendas activas: con al menos un
        pedido en 30 días en la misma cuenta. Con menos de {PRODUCT_RULES.minVolume} pedidos en dos semanas no se calcula el %. Los días
        disponibles salen de la fecha de alta en el catálogo (o del primer pedido).
      </p>
    </div>
  );
}

const FLAG: Record<ProductOpportunity["kind"], { label: string; tone: string }> = {
  hot: { label: "En racha", tone: "accent" },
  expansion: { label: "Expansión", tone: "success" },
  low_movement: { label: "Bajo movimiento", tone: "warning" },
  no_orders: { label: "Sin pedidos", tone: "danger" },
};

function ProductName({ p, showAccount, flag }: { p: ProductPerf; showAccount: boolean; flag?: ProductOpportunity | null }) {
  return (
    <div className="product-cell pp-name">
      {p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <span className="ph" aria-hidden><IconBox /></span>}
      <div style={{ minWidth: 0 }}>
        <div className="strong pp-clamp" title={p.name}>{p.name}</div>
        <div className="sub">
          {[
            p.status === "Inactivo" ? "Inactivo" : p.status === null ? "Fuera del catálogo" : null,
            p.stock !== null ? `${fmtInt(p.stock)} u. en inventario` : null,
            showAccount ? p.account_name : null,
          ].filter(Boolean).join(" · ")}
          {flag && <> · <span className="pp-flag" data-tone={FLAG[flag.kind].tone}>{FLAG[flag.kind].label}</span></>}
        </div>
      </div>
    </div>
  );
}

function TrendPill({ p }: { p: ProductPerf }) {
  const t = trend(p);
  const c = change(p);
  const showPct = c !== null && t !== "low";
  return (
    <span className="pp-trend">
      <span className="pill" data-tone={TREND[t].tone} title={TREND[t].hint}>{TREND[t].label}</span>
      {showPct && <span className="delta" data-tone={c > 0.15 ? "up" : c < -0.15 ? "down" : "flat"}>{c > 0 ? "+" : ""}{Math.round(c * 100)}%</span>}
    </span>
  );
}

/** Tiendas que lo venden de las activas de la cuenta, con barra de cobertura. */
function Coverage({ p }: { p: ProductPerf }) {
  const share = p.active_stores30 ? p.stores30 / p.active_stores30 : 0;
  return (
    <span className="pp-cov" title={`${p.stores30} de ${p.active_stores30} tiendas activas lo venden`}>
      <span>{fmtInt(p.stores30)}<span className="of">/{fmtInt(p.active_stores30)}</span></span>
      <span className="bar" aria-hidden><i style={{ width: `${Math.max(4, Math.round(share * 100))}%` }} /></span>
    </span>
  );
}

function Item({ p, o, showAccount }: { p: ProductPerf; o: ProductOpportunity; showAccount: boolean }) {
  return (
    <li className="pp-item" data-kind={o.kind}>
      <div className="top">
        <span className="strong pp-clamp" title={p.name}>{p.name}</span>
        <span className="pill" data-tone={FLAG[o.kind].tone}>{FLAG[o.kind].label}</span>
      </div>
      <p className="detail">{o.detail}{showAccount && <> · {p.account_name}</>}</p>
      <p className="action">→ {o.action}</p>
    </li>
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
