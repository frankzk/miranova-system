import Link from "next/link";
import { AccountChips } from "@/components/account-chips";
import { ProductsSubnav } from "@/components/products-subnav";
import { PageHead } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { crossSell, MATRIX_RULES, matrixGrid, type CrossSellItem, type Grid } from "@/lib/cross-sell";
import { fmtInt } from "@/lib/format";
import { getScope } from "@/lib/scope";
import { storeHref } from "@/lib/store-links";
import { MATRIX_DAYS, storeProductMatrix } from "@/lib/store-product-matrix";
import "./matrix.css";

export const metadata = { title: "Tienda × producto" };

type SP = Record<string, string | string[] | undefined>;
const PATH = "/products/matrix";
const SHOWN = 8;

export default async function StoreProductMatrixPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const raw = Number(Array.isArray(sp.days) ? sp.days[0] : sp.days);
  const days = (MATRIX_DAYS as readonly number[]).includes(raw) ? raw : 30;
  const accounts = await listAccounts();
  const scope = await getScope(accounts);
  const data = await storeProductMatrix(scope.account, days);

  const grids = data.accounts
    .map((a) => ({ account: a, grid: matrixGrid(data, a.account_id) }))
    .filter((g) => g.grid.rows.length > 0);
  const ideas = crossSell(data);
  const showAccount = grids.length > 1 || (!scope.account && accounts.length > 1);
  const accountName = new Map(data.accounts.map((a) => [a.account_id, a.account_name]));
  const href = (d: number) => (d === 30 ? PATH : `${PATH}?days=${d}`);

  return (
    <div className="page">
      <PageHead
        title="Tienda × producto"
        sub={<>Pedidos de cada tienda en cada producto · últimos {days} días · {scope.label}</>}
        actions={
          <nav className="segmented" aria-label="Período">
            {MATRIX_DAYS.map((d) => (
              <Link key={d} href={href(d)} aria-current={d === days}>{d} días</Link>
            ))}
          </nav>
        }
      />

      <ProductsSubnav />

      <AccountChips accounts={accounts} current={scope.account} next={href(days)} />

      <section className="panel mx-ideas">
        <div className="panel-head">
          <h2>Venta cruzada</h2>
          <span className="aside">Productos que una tienda fuerte nunca probó (90 días) y sus pares sí venden</span>
        </div>
        {ideas.length === 0 ? (
          <p className="mx-empty">
            Sin sugerencias por ahora. Aparecen cuando al menos {MATRIX_RULES.minPeers} tiendas venden el mismo producto principal que una tienda
            de volumen alto y la mayoría de ellas también vende otro que esa tienda nunca probó.
          </p>
        ) : (
          <ul className="mx-list">
            {ideas.slice(0, SHOWN).map((i) => (
              <Idea key={`${i.kind}:${i.account_id}:${i.store_id}:${i.product_key}`} i={i} account={showAccount ? accountName.get(i.account_id) : undefined} />
            ))}
          </ul>
        )}
        {ideas.length > SHOWN && <p className="mx-more">y {ideas.length - SHOWN} sugerencias más</p>}
      </section>

      {grids.length === 0 ? (
        <div className="table-wrap">
          <div className="empty">
            <h3>Sin pedidos en los últimos {days} días</h3>
            <p>Cuando las tiendas tengan pedidos en el período, aquí verás qué productos vende cada una.</p>
            {days < 90 && <Link className="btn" href={href(90)}>Ver 90 días</Link>}
          </div>
        </div>
      ) : (
        grids.map(({ account, grid }) => (
          <section key={account.account_id} className="mx-section">
            {showAccount && <h2 className="band-label">{account.account_name}<span>{fmtInt(grid.rows.length + grid.moreStores)} tiendas</span></h2>}
            <Matrix grid={grid} days={days} />
          </section>
        ))
      )}
      <p className="footnote">
        Cada celda son pedidos (sin cancelados ni rechazados) de la tienda que incluyen el producto. 🔥 marca el producto dominante de la
        tienda: al menos la mitad de sus pedidos. SKUs activos: productos distintos con pedidos en el período. Se muestran las{" "}
        {MATRIX_RULES.maxStores} tiendas y los {MATRIX_RULES.maxProducts} productos con más pedidos de cada cuenta.
      </p>
    </div>
  );
}

function Matrix({ grid, days }: { grid: Grid; days: number }) {
  const max = Math.max(1, ...grid.rows.flatMap((r) => r.cells));
  return (
    <div className="table-wrap">
      <div className="mx-scroll" tabIndex={0} aria-label="Matriz tienda × producto (desliza para ver más productos)">
        <table className="table mx-table">
          <thead>
            <tr>
              <th className="mx-store">Tienda</th>
              <th className="r" title={`Pedidos de la tienda en ${days} días`}>Pedidos</th>
              <th className="r" title="Productos distintos con pedidos en el período">SKUs</th>
              {grid.products.map((p) => (
                <th key={p.product_key} className="mx-prod" title={`${p.name} · ${p.orders} pedidos`}>
                  <span className="mx-pname">{p.name}</span>
                  <span className="mx-ptotal">{fmtInt(p.orders)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((r) => {
              const pace = r.store.orders / days;
              const single = r.store.skus === 1 && pace >= MATRIX_RULES.highPerDay;
              return (
                <tr key={r.store.store_id}>
                  <th scope="row" className="mx-store">
                    <Link className="strong" href={storeHref(r.store.account_id, r.store.store_id)} title={r.store.name}>{r.store.name}</Link>
                    <span className="sub">
                      {pace >= 10 ? Math.round(pace) : pace.toFixed(1)}/día
                      {single && <span title="Vende un solo producto: ofrecer un segundo"> · 📦 1 producto</span>}
                    </span>
                  </th>
                  <td className="num strong">{fmtInt(r.store.orders)}</td>
                  <td className="num">{fmtInt(r.store.skus)}</td>
                  {r.cells.map((n, i) => {
                    const dom = r.dominant && r.top === i;
                    return (
                      <td
                        key={grid.products[i].product_key}
                        className="num mx-cell"
                        data-zero={n === 0 || undefined}
                        data-top={r.top === i || undefined}
                        data-dom={dom || undefined}
                        style={n > 0 && !dom ? { ["--mx-a" as string]: (0.04 + 0.24 * (n / max)).toFixed(3) } : undefined}
                        title={`${r.store.name} · ${grid.products[i].name}: ${n} pedidos${dom ? ` (${Math.round((n / r.store.orders) * 100)}% de la tienda)` : ""}`}
                      >
                        {n === 0 ? "·" : <>{dom && "🔥 "}{fmtInt(n)}</>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(grid.moreStores > 0 || grid.moreProducts > 0) && (
        <p className="mx-more">
          {[grid.moreStores > 0 && `${fmtInt(grid.moreStores)} tiendas`, grid.moreProducts > 0 && `${fmtInt(grid.moreProducts)} productos`].filter(Boolean).join(" y ")}{" "}
          más con pedidos en el período, con menos volumen
        </p>
      )}
    </div>
  );
}

function Idea({ i, account }: { i: CrossSellItem; account?: string }) {
  return (
    <li className="mx-idea" data-kind={i.kind}>
      <Link className="strong" href={storeHref(i.account_id, i.store_id)}>{i.title}</Link>
      <p className="detail">{i.detail}{account && <> · {account}</>}</p>
      <p className="action">→ {i.action}</p>
    </li>
  );
}
