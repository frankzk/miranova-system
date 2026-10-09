import Link from "next/link";
import { AccountChips } from "@/components/account-chips";
import { Drawer, DrawerClose } from "@/components/client";
import { IconBox } from "@/components/icons";
import { ProductsSubnav } from "@/components/products-subnav";
import { CancelRestockForm, LeadTimeForm, RestockOrderForm, SendDigestForm } from "@/components/restock-forms";
import { PageHead } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { requirePermission } from "@/lib/auth";
import { fmtInt, fmtShort, todayHN } from "@/lib/format";
import {
  addDays, dayLabel, INVENTORY_RULES, LEAD_SOURCE, LEVEL_ORDER, productKey, REORDER, REORDER_LEVEL, reorderPlan, returnRate,
  urgency, type InventoryRow, type ReorderLevel, type ReorderPlan,
} from "@/lib/inventory";
import { inventoryStatus, inventorySupply } from "@/lib/inventory-data";
import { getScope } from "@/lib/scope";
import { cancelRestockOrder, placeRestockOrder, saveLeadTime, sendDigestNow } from "./actions";
import "./inventory.css";

export const metadata = { title: "Inventario" };

const PATH = "/products/inventory";
const u = (n: number) => `${fmtInt(n)} u.`;
const rate = (n: number) => (n >= 10 ? String(Math.round(n)) : n.toFixed(1));
const days = (n: number) => `${n} ${n === 1 ? "día" : "días"}`;

/** Etiqueta de "cuándo pedir" para la tabla y la lista. */
function whenLabel(p: ReorderPlan, today: string) {
  if (p.level === "idle") return "Sin salidas";
  if (p.level === "out") return p.needsOrder ? "Agotado · pedir hoy" : "Agotado · ya viene";
  if (p.level === "now") return "Pedir hoy";
  const by = dayLabel(p.orderBy!, today);
  if (p.level === "soon") return by === "hoy" ? "Pedir hoy" : by === "mañana" ? "Pedir mañana" : `Pedir antes del ${by}`;
  return "Al día";
}

/** Una frase con la decisión, para el panel del producto. */
function verdict(p: ReorderPlan, today: string) {
  if (p.level === "idle") return "No salió nada en 14 días: no hace falta pedir.";
  const parts: string[] = [];
  if (p.level === "out") parts.push("Agotado", ...(p.needsOrder ? [`Pedir ya unas ${u(p.qty)}`] : []));
  else if (p.level === "now") parts.push(`Pedir hoy unas ${u(p.qty)}: con lo que hay${p.inTransit ? " y lo que viene" : ""} no alcanza mientras llega`);
  else if (p.level === "soon") parts.push(`${whenLabel(p, today)}: unas ${u(p.qty)}`);
  else parts.push(`Al día: el próximo pedido toca el ${dayLabel(p.orderBy!, today)}`);
  const eta = p.open.map((o) => o.eta).filter((e): e is string => Boolean(e)).sort()[0];
  if (p.inTransit) parts.push(`Vienen ${u(p.inTransit)}${eta ? ` (llegada ${dayLabel(eta, today)})` : ""}`);
  // "u." ya termina en punto: no se repite
  return parts.map((s) => (s.endsWith(".") ? s : `${s}.`)).join(" ");
}

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, accounts] = await Promise.all([requirePermission("products"), listAccounts()]);
  const sp = await searchParams;
  const pick = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const scope = await getScope(accounts);
  const [all, supply] = await Promise.all([inventoryStatus(scope.account), inventorySupply(scope.account)]);
  const today = todayHN();

  const plans = new Map(all.map((r) => [r, reorderPlan(r, supply, today)]));
  const planOf = (r: InventoryRow) => plans.get(r)!;
  const level = pick("l") in REORDER_LEVEL ? (pick("l") as ReorderLevel) : undefined;
  const selKey = pick("p");
  const counts = Object.fromEntries(LEVEL_ORDER.map((k) => [k, all.filter((r) => planOf(r).level === k).length]));
  const sorted = [...all].sort((a, b) => urgency(planOf(a)) - urgency(planOf(b)) || planOf(b).demand - planOf(a).demand || b.stock - a.stock);
  const rows = sorted.filter((r) => !level || planOf(r).level === level);
  const toOrder = sorted.filter((r) => planOf(r).needsOrder && ["out", "now", "soon"].includes(planOf(r).level));
  const coming = all.filter((r) => planOf(r).open.length > 0);
  const comingUnits = coming.reduce((t, r) => t + planOf(r).inTransit, 0);
  const late = coming.filter((r) => planOf(r).open.some((o) => o.status === "late")).length;
  const showAccount = !scope.account && accounts.length > 1;

  const href = (patch: { l?: string; p?: string }) => {
    const q = new URLSearchParams();
    const l = "l" in patch ? patch.l : level;
    const p = "p" in patch ? patch.p : selKey;
    if (l) q.set("l", l);
    if (p) q.set("p", p);
    const s = q.toString();
    return s ? `${PATH}?${s}` : PATH;
  };
  const closeHref = href({ p: undefined });
  const keyOf = (r: InventoryRow) => productKey(r.account_id, r.external_id);
  const sel = selKey ? all.find((r) => keyOf(r) === selKey) : undefined;

  return (
    <div className="page">
      <PageHead
        title="Inventario"
        sub={<>{fmtInt(all.length)} productos · {scope.label} · cuándo pedir según la venta reciente y lo que tarda en llegar cada reposición</>}
        actions={user.is_owner && <SendDigestForm action={sendDigestNow} />}
      />
      <ProductsSubnav />
      <AccountChips accounts={accounts} current={scope.account} next={href({ p: undefined })} />

      <section className="metrics" aria-label="Resumen de inventario">
        <Link className="metric" href={href({ l: "out", p: undefined })} data-alert={counts.out > 0 || undefined}>
          <span className="label"><span className="dot" data-tone="danger" aria-hidden />Agotados</span>
          <span className="value">{fmtInt(counts.out ?? 0)}</span>
          <span className="foot">Sin existencia y con demanda</span>
        </Link>
        <Link className="metric" href={href({ l: "now", p: undefined })}>
          <span className="label"><span className="dot" data-tone="danger" aria-hidden />Pedir hoy</span>
          <span className="value">{fmtInt(counts.now ?? 0)}</span>
          <span className="foot">Ya pasaron su punto de pedido</span>
        </Link>
        <Link className="metric" href={href({ l: "soon", p: undefined })}>
          <span className="label"><span className="dot" data-tone="warning" aria-hidden />Pedir esta semana</span>
          <span className="value">{fmtInt(counts.soon ?? 0)}</span>
          <span className="foot">Llegan al punto de pedido en {REORDER.soon} días</span>
        </Link>
        <div className="metric" data-alert={late > 0 || undefined}>
          <span className="label">En camino</span>
          <span className="value">{fmtInt(coming.length)}</span>
          <span className="foot">
            {coming.length === 0 ? "Marca “Ya lo pedí” al pedir" : <>{u(comingUnits)}{late > 0 && <> · {late} {late === 1 ? "atrasado" : "atrasados"}</>}</>}
          </span>
        </div>
      </section>

      {toOrder.length > 0 && !level && (
        <section className="panel inv-reorder" aria-labelledby="inv-reorder-title">
          <div className="panel-head">
            <h2 id="inv-reorder-title">Qué pedir</h2>
            <span className="aside">Cubre lo que tarda en llegar, un colchón y {REORDER.cover} días de venta</span>
          </div>
          <ul className="list-rows panel-flush">
            {toOrder.slice(0, 12).map((r) => {
              const p = planOf(r);
              return (
                <li key={keyOf(r)}>
                  <div className="inv-row">
                    <span className="t" title={r.name}>{r.name}</span>
                    <span className="need">Pedir {u(p.qty)}</span>
                    <span className="s">
                      <span className="pill" data-tone={REORDER_LEVEL[p.level].tone}>{whenLabel(p, today)}</span>
                      {" "}{u(r.stock)} · vende {rate(p.demand)}/día · tarda {days(p.lead)}
                      {p.inTransit > 0 && <> · vienen {u(p.inTransit)}</>}
                      {showAccount && <> · {r.account_name}</>}
                    </span>
                    <Link className="btn btn-sm btn-primary" href={href({ p: keyOf(r) })} scroll={false}>Ya lo pedí</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <nav className="tabs" aria-label="Filtrar por nivel de inventario">
        <Link href={href({ l: undefined, p: undefined })} aria-current={!level}>Todos <span className="c">{fmtInt(all.length)}</span></Link>
        {LEVEL_ORDER.map((k) => (
          <Link key={k} href={href({ l: k, p: undefined })} aria-current={level === k} title={REORDER_LEVEL[k].hint}>
            <span className="dot" data-tone={REORDER_LEVEL[k].tone} aria-hidden />
            {REORDER_LEVEL[k].label} <span className="c">{fmtInt(counts[k] ?? 0)}</span>
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
              {rows.map((r) => <Card key={keyOf(r)} r={r} p={planOf(r)} today={today} showAccount={showAccount} open={href({ p: keyOf(r) })} />)}
            </ul>
            <div className="table-scroll not-sm">
              <table className="table inv-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="r">Existencia</th>
                    <th className="r" title="La más alta entre la venta neta de los últimos 7 y 14 días">Vende por día</th>
                    <th className="r" title="Días que tarda en llegar una reposición">Tarda</th>
                    <th className="r" title="Al bajar de aquí (existencia + lo que viene), hay que pedir">Punto de pedido</th>
                    <th>Cuándo pedir</th>
                    <th className="r">Pedir</th>
                    <th><span className="sr-only">Acción</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const p = planOf(r);
                    const up = p.rate7 > p.rate14 * 1.2 && p.rate14 > 0;
                    return (
                      <tr key={keyOf(r)} aria-selected={selKey === keyOf(r) || undefined}>
                        <td>
                          <div className="product-cell">
                            {r.image_url ? <img src={r.image_url} alt="" loading="lazy" /> : <span className="ph" aria-hidden><IconBox /></span>}
                            <div style={{ minWidth: 0 }}>
                              <div className="strong clip" style={{ maxWidth: 230 }} title={r.name}>{r.name}</div>
                              <div className="sub">
                                {r.code ?? "—"}
                                {r.pending_orders > 0 && <> · {fmtInt(r.pending_orders)} por despachar</>}
                                {showAccount && <> · {r.account_name}</>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="num">
                          <span className="strong">{u(r.stock)}</span>
                          {p.inTransit > 0 && <div className="sub">+{fmtInt(p.inTransit)} en camino</div>}
                        </td>
                        <td className="num">
                          {p.demand > 0 ? rate(p.demand) : <span className="subtle">0</span>}
                          {up && <div className="sub inv-up" title={`Últimos 7 días: ${rate(p.rate7)}/día · 14 días: ${rate(p.rate14)}/día`}>subiendo</div>}
                        </td>
                        <td className="num">
                          {days(p.lead)}
                          {p.leadSource !== "default" && <div className="sub">{p.leadSource === "manual" ? "a mano" : "medido"}</div>}
                        </td>
                        <td className="num">{p.demand > 0 ? u(p.reorderPoint) : <span className="subtle">—</span>}</td>
                        <td>
                          <span className="pill" data-tone={REORDER_LEVEL[p.level].tone} title={REORDER_LEVEL[p.level].hint}>
                            {p.level === "out" ? "Agotado" : whenLabel(p, today)}
                          </span>
                          {p.level === "out" && <div className="sub">{p.needsOrder ? "pedir hoy" : p.inTransit ? "ya viene" : "sin salidas recientes"}</div>}
                          {p.gapDays !== null && p.gapDays > 0 && <div className="sub inv-gap">{days(p.gapDays)} sin stock antes de que llegue</div>}
                          {p.open.some((o) => o.status === "late") && <div className="sub inv-gap">pedido atrasado</div>}
                        </td>
                        <td className="num strong">{p.needsOrder && p.qty > 0 ? u(p.qty) : <span className="subtle">—</span>}</td>
                        <td className="r">
                          <Link className={`btn btn-sm${p.needsOrder ? " btn-primary" : ""}`} href={href({ p: keyOf(r) })} scroll={false}>
                            {p.needsOrder ? "Ya lo pedí" : "Ver"}
                          </Link>
                        </td>
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
        Venta por día: la más alta entre los últimos 7 y 14 días (salidas por pedido menos devoluciones), para no quedarse corto
        cuando la venta sube. Punto de pedido = venta por día × días que tarda en llegar + un colchón por lo que varía la venta.
        Si no fijas cuánto tarda, se usa lo medido con los pedidos que marcas como pedidos y llegan; si no hay, {REORDER.defaultLead} días.
        Un pedido deja de estar en camino cuando Drop registra la entrada de mercadería.
      </p>

      {sel && <ProductDrawer r={sel} p={planOf(sel)} today={today} closeHref={closeHref} />}
    </div>
  );
}

function ProductDrawer({ r, p, today, closeHref }: { r: InventoryRow; p: ReorderPlan; today: string; closeHref: string }) {
  const rr = returnRate(r);
  const arrived = p.orders.filter((o) => o.status === "arrived").slice(-3).reverse();
  return (
    <Drawer closeHref={closeHref} label={`Reposición de ${r.name}`}>
      <div className="drawer-head">
        <div className="grow">
          <h2 className="sheet-title">{r.name}</h2>
          <p className="sheet-sub">{r.account_name}{r.code && <> · {r.code}</>}</p>
        </div>
        <DrawerClose href={closeHref} />
      </div>
      <div className="drawer-body">
        <div className="section">
          <p className="rs-verdict" data-tone={REORDER_LEVEL[p.level].tone}>
            <span className="dot" data-tone={REORDER_LEVEL[p.level].tone} aria-hidden />
            {verdict(p, today)}
          </p>
          {p.gapDays !== null && p.gapDays > 0 && (
            <p className="rs-warn">Se agota {days(p.gapDays)} antes de que llegue lo pedido: conviene avisar a las tiendas que lo venden.</p>
          )}
          <dl className="kv">
            <dt>Existencia</dt>
            <dd>{u(r.stock)}{p.inTransit > 0 && <span className="muted"> + {u(p.inTransit)} en camino</span>}</dd>
            <dt>Vende por día</dt>
            <dd>{rate(p.demand)} <span className="muted">· 7 días: {rate(p.rate7)} · 14 días: {rate(p.rate14)}</span></dd>
            <dt>Tarda en llegar</dt>
            <dd>{days(p.lead)} <span className="muted">· {LEAD_SOURCE[p.leadSource]}{p.leadSamples > 0 && ` (${p.leadSamples} ${p.leadSamples === 1 ? "pedido llegó" : "pedidos llegaron"})`}</span></dd>
            {p.demand > 0 && (
              <>
                <dt>Colchón</dt>
                <dd>{u(p.safety)} <span className="muted">· por lo que varía la venta de un día a otro</span></dd>
                <dt>Punto de pedido</dt>
                <dd>{u(p.reorderPoint)} <span className="muted">· {rate(p.demand)} × {days(p.lead)} + colchón</span></dd>
                <dt>Se agota</dt>
                <dd>{p.level === "out" ? "ya está agotado" : `${dayLabel(p.stockoutOn!, today)} si no llega nada`}</dd>
                <dt>Sugerido</dt>
                <dd>{u(p.qty)} <span className="muted">· cubre la reposición, el colchón y {REORDER.cover} días</span></dd>
              </>
            )}
            <dt>Últimos 30 días</dt>
            <dd><Spark days={r.daily} /></dd>
            <dt>Devoluciones</dt>
            <dd>{rr === null ? "—" : `${Math.round(rr * 100)}% en 30 días`}{rr !== null && rr >= INVENTORY_RULES.highReturns && <span className="muted"> · altas</span>}</dd>
          </dl>
        </div>

        <div className="section">
          <h3>Ya lo pedí</h3>
          <RestockOrderForm
            action={placeRestockOrder} accountId={r.account_id} productId={r.external_id}
            suggested={p.qty} eta={addDays(today, p.lead)} today={today} closeHref={closeHref}
          />
        </div>

        {p.open.length > 0 && (
          <div className="section">
            <h3>En camino</h3>
            <ul className="rs-orders">
              {p.open.map((o) => (
                <li key={o.id}>
                  <div className="grow">
                    <span className="strong">{u(o.units)}</span>
                    <span className="muted"> · pedido el {fmtShort(o.ordered_at)}{o.eta && <> · llegada {dayLabel(o.eta, today)}</>}</span>
                    {o.status === "late" && <> <span className="pill" data-tone="warning">Atrasado</span></>}
                    {o.note && <div className="sub">{o.note}</div>}
                  </div>
                  <CancelRestockForm action={cancelRestockOrder} orderId={o.id} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {arrived.length > 0 && (
          <div className="section">
            <h3>Llegaron</h3>
            <ul className="rs-orders">
              {arrived.map((o) => (
                <li key={o.id}>
                  <div className="grow">
                    <span className="strong">{u(o.arrived_units ?? o.units)}</span>
                    <span className="muted"> · el {fmtShort(o.arrived_at)} · tardó {days(Math.max(0, Math.round((Date.parse(o.arrived_at!) - Date.parse(o.ordered_at)) / 86_400_000)))}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="section">
          <h3>Tiempo de reposición</h3>
          <LeadTimeForm action={saveLeadTime} accountId={r.account_id} productId={r.external_id} current={p.lead} manual={p.leadSource === "manual"} />
        </div>
      </div>
    </Drawer>
  );
}

function Card({ r, p, today, showAccount, open }: { r: InventoryRow; p: ReorderPlan; today: string; showAccount: boolean; open: string }) {
  return (
    <li>
      <div className="top">
        <span className="strong">{r.name}</span>
        <span className="pill" data-tone={REORDER_LEVEL[p.level].tone}>{whenLabel(p, today)}</span>
      </div>
      {showAccount && <div className="sub">{r.account_name}</div>}
      <Spark days={r.daily} />
      <dl>
        <div><dt>Existencia</dt><dd>{u(r.stock)}</dd></div>
        <div><dt>Vende por día</dt><dd>{p.demand > 0 ? rate(p.demand) : "0"}</dd></div>
        <div><dt>En camino</dt><dd>{p.inTransit ? u(p.inTransit) : "—"}</dd></div>
        <div><dt>Pedir</dt><dd>{p.needsOrder && p.qty > 0 ? u(p.qty) : "—"}</dd></div>
      </dl>
      <Link className={`btn btn-sm inv-card-btn${p.needsOrder ? " btn-primary" : ""}`} href={open} scroll={false}>
        {p.needsOrder ? "Ya lo pedí" : "Ver detalle"}
      </Link>
    </li>
  );
}

/** Salida neta por día, 30 días (la última barra es hoy). */
function Spark({ days: series }: { days: number[] }) {
  const max = Math.max(1, ...series);
  const n = series.length || 1;
  return (
    <svg className="spark" viewBox={`0 0 ${n * 4} 24`} preserveAspectRatio="none" role="img" aria-label={`Unidades que salieron por día, últimos 30 días: ${series.join(", ")}`}>
      {series.map((v, i) => {
        const h = Math.max(v > 0 ? 2 : 1, (Math.max(0, v) / max) * 24);
        return <rect key={i} x={i * 4 + 0.5} y={24 - h} width={3} height={h} data-today={i === n - 1 || undefined} data-zero={v <= 0 || undefined} />;
      })}
    </svg>
  );
}
