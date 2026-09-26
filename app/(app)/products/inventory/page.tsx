import Link from "next/link";
import { AccountChips } from "@/components/account-chips";
import { IconBox } from "@/components/icons";
import { ProductsSubnav } from "@/components/products-subnav";
import { PageHead } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { fmtInt, fmtShort } from "@/lib/format";
import {
  daysLeft, INVENTORY_RULES, LEVEL_ORDER, perDay, reorderList, returnRate, STOCK_LEVEL, stockLevel, toCover,
  type InventoryRow, type StockLevel,
} from "@/lib/inventory";
import { inventoryStatus } from "@/lib/inventory-data";
import { getScope } from "@/lib/scope";
import "./inventory.css";

export const metadata = { title: "Inventario" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ l?: string }> }) {
  const sp = await searchParams;
  const accounts = await listAccounts();
  const scope = await getScope(accounts);
  const all = await inventoryStatus(scope.account);

  const level = new Map(all.map((r) => [r, stockLevel(r)]));
  const l = sp.l && sp.l in STOCK_LEVEL ? (sp.l as StockLevel) : undefined;
  const counts = Object.fromEntries(LEVEL_ORDER.map((k) => [k, all.filter((r) => level.get(r) === k).length]));
  // orden por urgencia: agotados con demanda, luego los que menos días tienen, luego el resto por salida
  const urgent = reorderList(all);
  const rest = all.filter((r) => !urgent.includes(r)).sort((a, b) => perDay(b) - perDay(a) || b.stock - a.stock);
  const rows = [...urgent, ...rest].filter((r) => !l || level.get(r) === l);
  const out30 = all.reduce((t, r) => t + r.out30, 0);
  const ret30 = all.reduce((t, r) => t + r.ret30, 0);
  const showAccount = !scope.account && accounts.length > 1;
  const href = (k?: StockLevel) => (k ? `/products/inventory?l=${k}` : "/products/inventory");

  return (
    <div className="page">
      <PageHead
        title="Inventario"
        sub={<>{fmtInt(all.length)} productos · {scope.label} · según los movimientos de Drop: salidas por pedido menos devoluciones, promedio de 14 días</>}
      />
      <ProductsSubnav />
      <AccountChips accounts={accounts} current={scope.account} next={href(l)} />

      <section className="metrics" aria-label="Resumen de inventario">
        <Link className="metric" href={href("out")} data-alert={counts.out > 0}>
          <span className="label"><span className="dot" data-tone="danger" aria-hidden />Agotados</span>
          <span className="value">{fmtInt(counts.out ?? 0)}</span>
          <span className="foot">Sin existencia y con demanda</span>
        </Link>
        <Link className="metric" href={href("critical")}>
          <span className="label"><span className="dot" data-tone="danger" aria-hidden />Reponer ya</span>
          <span className="value">{fmtInt(counts.critical ?? 0)}</span>
          <span className="foot">Alcanzan para menos de {INVENTORY_RULES.critical} días</span>
        </Link>
        <Link className="metric" href={href("low")}>
          <span className="label"><span className="dot" data-tone="warning" aria-hidden />Reponer pronto</span>
          <span className="value">{fmtInt(counts.low ?? 0)}</span>
          <span className="foot">Menos de {INVENTORY_RULES.low} días</span>
        </Link>
        <div className="metric">
          <span className="label">Devoluciones · 30 días</span>
          <span className="value">{out30 ? `${Math.round((ret30 / out30) * 100)}%` : "—"}</span>
          <span className="foot">{fmtInt(ret30)} de {fmtInt(out30)} u. volvieron al almacén</span>
        </div>
      </section>

      {urgent.length > 0 && !l && (
        <section className="panel inv-reorder" aria-labelledby="inv-reorder-title">
          <div className="panel-head">
            <h2 id="inv-reorder-title">Qué reponer</h2>
            <span className="aside">Sugerencia para cubrir 30 días al ritmo actual</span>
          </div>
          <ul className="list-rows panel-flush">
            {urgent.slice(0, 10).map((r) => {
              const lv = level.get(r)!;
              const days = daysLeft(r);
              return (
                <li key={`${r.account_id}:${r.external_id}`}>
                  <div className="inv-row">
                    <span className="t">{r.name}</span>
                    <span className="pill" data-tone={STOCK_LEVEL[lv].tone}>{lv === "out" ? "Agotado" : `${days! < 1 ? "< 1" : Math.floor(days!)} d`}</span>
                    <span className="s">
                      {fmtInt(r.stock)} u. · sale {perDay(r).toFixed(1)}/día
                      {r.pending_orders > 0 && <> · {fmtInt(r.pending_orders)} pedidos esperando</>}
                      {showAccount && <> · {r.account_name}</>}
                    </span>
                    <span className="s need">Pedir ~{fmtInt(toCover(r, 30))} u.</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <nav className="tabs" aria-label="Filtrar por nivel de inventario">
        <Link href={href()} aria-current={!l}>Todos <span className="c">{fmtInt(all.length)}</span></Link>
        {LEVEL_ORDER.map((k) => (
          <Link key={k} href={href(k)} aria-current={l === k} title={STOCK_LEVEL[k].hint}>
            <span className="dot" data-tone={STOCK_LEVEL[k].tone} aria-hidden />
            {STOCK_LEVEL[k].label} <span className="c">{fmtInt(counts[k] ?? 0)}</span>
          </Link>
        ))}
      </nav>

      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty">
            <h3>{all.length === 0 ? "Aún no hay movimientos de inventario" : "Ningún producto en este nivel"}</h3>
            <p>{all.length === 0 ? "Se descargan con la sincronización (unos 20 productos cada 10 minutos)." : "Prueba con otra pestaña."}</p>
          </div>
        ) : (
          <>
            <ul className="inv-cards only-sm">
              {rows.map((r) => <Card key={`${r.account_id}:${r.external_id}`} r={r} lv={level.get(r)!} showAccount={showAccount} />)}
            </ul>
            <div className="table-scroll not-sm">
              <table className="table inv-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="r">Existencia</th>
                    <th className="r" title="Salidas por pedido menos devoluciones, promedio de 14 días">Sale por día</th>
                    <th>Alcanza</th>
                    <th className="r" title="Unidades devueltas sobre unidades despachadas, 30 días">Devoluciones</th>
                    <th className="hide-md">Última reposición</th>
                    <th className="hide-md">30 días</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const lv = level.get(r)!;
                    const days = daysLeft(r);
                    const rr = returnRate(r);
                    const last = r.restocks[0];
                    return (
                      <tr key={`${r.account_id}:${r.external_id}`}>
                        <td>
                          <div className="product-cell">
                            {r.image_url ? <img src={r.image_url} alt="" loading="lazy" /> : <span className="ph" aria-hidden><IconBox /></span>}
                            <div style={{ minWidth: 0 }}>
                              <div className="strong clip" style={{ maxWidth: 320 }} title={r.name}>{r.name}</div>
                              <div className="sub">
                                {r.code ?? "—"}
                                {r.pending_orders > 0 && <> · {fmtInt(r.pending_orders)} pedidos por despachar</>}
                                {showAccount && <> · {r.account_name}</>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="num strong">{fmtInt(r.stock)} u.</td>
                        <td className="num">{perDay(r).toFixed(1)}</td>
                        <td>
                          <span className="pill" data-tone={STOCK_LEVEL[lv].tone} title={STOCK_LEVEL[lv].hint}>
                            {lv === "out" ? "Agotado" : days === null ? "Sin salidas" : `${days < 1 ? "< 1" : Math.floor(days)} días`}
                          </span>
                        </td>
                        <td className="num" data-high={rr !== null && rr >= INVENTORY_RULES.highReturns || undefined}>
                          {rr === null ? <span className="subtle">—</span> : `${Math.round(rr * 100)}%`}
                        </td>
                        <td className="hide-md nowrap">
                          {last ? <>{fmtShort(last.at)} <span className="muted">· +{fmtInt(last.units)} u.</span></> : <span className="subtle">—</span>}
                        </td>
                        <td className="hide-md"><Spark days={r.daily} /></td>
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
        Existencia del catálogo de Drop. Salidas y devoluciones, de sus movimientos de inventario (se revisan unos 20 productos
        por sincronización). Las reservas y liberaciones no cuentan como venta. &ldquo;Reponer&rdquo; sugiere lo necesario para 30 días al ritmo actual.
      </p>
    </div>
  );
}

function Card({ r, lv, showAccount }: { r: InventoryRow; lv: StockLevel; showAccount: boolean }) {
  const days = daysLeft(r);
  const rr = returnRate(r);
  return (
    <li>
      <div className="top">
        <span className="strong">{r.name}</span>
        <span className="pill" data-tone={STOCK_LEVEL[lv].tone}>{lv === "out" ? "Agotado" : days === null ? "Sin salidas" : `${days < 1 ? "< 1" : Math.floor(days)} días`}</span>
      </div>
      {showAccount && <div className="sub">{r.account_name}</div>}
      <Spark days={r.daily} />
      <dl>
        <div><dt>Existencia</dt><dd>{fmtInt(r.stock)} u.</dd></div>
        <div><dt>Sale por día</dt><dd>{perDay(r).toFixed(1)}</dd></div>
        <div><dt>Devoluciones</dt><dd>{rr === null ? "—" : `${Math.round(rr * 100)}%`}</dd></div>
        <div><dt>Por despachar</dt><dd>{fmtInt(r.pending_orders)}</dd></div>
      </dl>
    </li>
  );
}

/** Salida neta por día, 30 días (la última barra es hoy). */
function Spark({ days }: { days: number[] }) {
  const max = Math.max(1, ...days);
  const n = days.length || 1;
  return (
    <svg className="spark" viewBox={`0 0 ${n * 4} 24`} preserveAspectRatio="none" role="img" aria-label={`Unidades que salieron por día, últimos 30 días: ${days.join(", ")}`}>
      {days.map((v, i) => {
        const h = Math.max(v > 0 ? 2 : 1, (Math.max(0, v) / max) * 24);
        return <rect key={i} x={i * 4 + 0.5} y={24 - h} width={3} height={h} data-today={i === n - 1 || undefined} data-zero={v <= 0 || undefined} />;
      })}
    </svg>
  );
}
