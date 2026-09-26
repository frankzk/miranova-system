import Link from "next/link";
import { AccountChips } from "@/components/account-chips";
import { IconChevronRight } from "@/components/icons";
import { PageHead } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import {
  change, concentration, deliveryRate, otherCountries, parsePeriod, PERIODS, PRODUCT_READ, readProducts, STORE_FLOW,
  type StoreItem,
} from "@/lib/business";
import { fmtInt, fmtMoney } from "@/lib/format";
import { businessOverview } from "@/lib/queries";
import { getScope } from "@/lib/scope";

export const metadata = { title: "Negocio" };

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};

const usd = (n: number) => fmtMoney(n, "USD", { compact: true, always: true });
const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)} %`);

function Delta({ cur, prev }: { cur: number; prev: number }) {
  const c = change(cur, prev);
  if (c === null) return <span className="delta" data-tone="flat">{cur > 0 ? "nuevo" : "—"}</span>;
  const tone = c > 0 ? "up" : c < 0 ? "down" : "flat";
  return <span className="delta" data-tone={tone}>{c > 0 ? "+" : c < 0 ? "−" : ""}{Math.abs(c)}{" "}%</span>;
}

function Share({ value }: { value: number }) {
  return (
    <span className="share" title={`${Math.round(value * 100)} % del total`}>
      <i style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
    </span>
  );
}

export default async function BusinessPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const accounts = await listAccounts();
  const scope = await getScope(accounts);
  const days = parsePeriod(one(sp, "d"));
  const countryParam = one(sp, "c")?.toUpperCase();
  const knownCountries = [...new Set(accounts.map((a) => a.country))];
  const country = countryParam && knownCountries.includes(countryParam) ? countryParam : undefined;

  const data = await businessOverview({ account: scope.account, days, country });

  const href = (patch: { d?: number; c?: string | null }) => {
    const p = new URLSearchParams();
    const d = patch.d ?? days;
    const c = patch.c === undefined ? country : patch.c ?? undefined;
    if (d !== 30) p.set("d", String(d));
    if (c) p.set("c", c);
    const s = p.toString();
    return s ? `/business?${s}` : "/business";
  };

  const totalOrders = data.countries.reduce((t, c) => t + c.orders, 0);
  const totalNet = data.countries.reduce((t, c) => t + c.net_usd, 0);
  const prevNet = data.countries.reduce((t, c) => t + c.prev_net_usd, 0);
  const prevOrders = data.countries.reduce((t, c) => t + c.prev_orders, 0);
  const countriesShown = [...new Set(data.countries.map((c) => c.country))];
  const conc = concentration(data.stores.top, data.stores.total);
  const reads = readProducts(data.products);
  const others = otherCountries(data.products);
  const where = country ? ` · ${country}` : "";
  const multiCountry = !country && countriesShown.length > 1;

  return (
    <div className="page">
      <PageHead
        title="Negocio"
        sub={<>Últimos {days} días frente a los {days} anteriores · {scope.label}{where}</>}
        actions={
          <nav className="segmented" aria-label="Período">
            {PERIODS.map((p) => (
              <Link key={p} href={href({ d: p })} aria-current={p === days}>{p} días</Link>
            ))}
          </nav>
        }
      />

      <AccountChips accounts={accounts} current={scope.account} next={href({})} />

      {/* Resumen */}
      <section className="metrics" aria-label="Resumen del período">
        <div className="metric">
          <span className="label">Pedidos</span>
          <span className="value">{fmtInt(totalOrders)}</span>
          <span className="foot"><Delta cur={totalOrders} prev={prevOrders} />&nbsp;vs. {fmtInt(prevOrders)}</span>
        </div>
        <div className="metric">
          <span className="label">Neto entregado (USD)</span>
          <span className="value">{usd(totalNet)}</span>
          <span className="foot"><Delta cur={totalNet} prev={prevNet} />&nbsp;vs. {usd(prevNet)}</span>
        </div>
        <div className="metric">
          <span className="label">Tiendas activas</span>
          <span className="value">{fmtInt(data.stores.active)}</span>
          <span className="foot">{fmtInt(data.stores.new)} nuevas · {fmtInt(data.stores.lost)} perdidas{where}</span>
        </div>
        <div className="metric">
          <span className="label">Concentración</span>
          <span className="value">{pct(conc.top3)}</span>
          <span className="foot">de los pedidos en las 3 primeras tiendas{where}</span>
        </div>
      </section>

      {/* Países */}
      <section className="panel section-gap" aria-labelledby="h-countries">
        <div className="panel-head">
          <h2 id="h-countries">Países</h2>
          <span className="aside">Toca un país para ver sus tiendas, productos y operación</span>
        </div>
        <div className="table-scroll panel-flush">
          <table className="table biz-table">
            <thead>
              <tr>
                <th>Cuenta</th>
                <th className="r">Pedidos</th>
                <th className="r">vs. anterior</th>
                <th className="r hide-md">% del total</th>
                <th className="r">Neto (USD)</th>
                <th className="r hide-md">vs. anterior</th>
                <th className="r">Entrega</th>
                <th className="r hide-md">Cancelados</th>
                <th className="r hide-md">Tiendas</th>
              </tr>
            </thead>
            <tbody>
              {data.countries.map((c) => (
                <tr key={c.account_id} aria-selected={country === c.country}>
                  <td>
                    <Link className="link" href={href({ c: country === c.country ? null : c.country })}>
                      {c.account}
                    </Link>
                  </td>
                  <td className="num">{fmtInt(c.orders)}</td>
                  <td className="num"><Delta cur={c.orders} prev={c.prev_orders} /></td>
                  <td className="num hide-md">{pct(totalOrders ? c.orders / totalOrders : null)}</td>
                  <td className="num">{usd(c.net_usd)}</td>
                  <td className="num hide-md"><Delta cur={c.net_usd} prev={c.prev_net_usd} /></td>
                  <td className="num">{pct(deliveryRate(c.delivered, c.failed))}</td>
                  <td className="num hide-md">{pct(c.received ? c.cancelled / c.received : null)}</td>
                  <td className="num hide-md">{fmtInt(c.stores)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="panel-note muted">
          Entrega: entregados ÷ (entregados + no entregados) entre los pedidos del período que ya cerraron. Neto: lo que liquida la plataforma por los entregados, convertido con su tipo de cambio.
        </p>
      </section>

      {country && (
        <nav className="chips" aria-label="Filtro de país">
          <Link href={href({ c: null })}>Todos los países</Link>
          {countriesShown.map((c) => (
            <Link key={c} href={href({ c })} aria-current={c === country}>{c}</Link>
          ))}
        </nav>
      )}

      {/* Tiendas */}
      <div className="grid-2">
        <section className="panel" aria-labelledby="h-stores">
          <div className="panel-head">
            <h2 id="h-stores">Tiendas{where}</h2>
            <Link className="aside link" href="/stores">Ver salud de tiendas <IconChevronRight /></Link>
          </div>
          <dl className="flow">
            {([
              ["Activas", data.stores.active, null],
              ["Nuevas", data.stores.new, "new"],
              ["Recuperadas", data.stores.recovered, "recovered"],
              ["Creciendo", data.stores.growing, "growing"],
              ["Cayendo", data.stores.falling, "falling"],
              ["Perdidas", data.stores.lost, "lost"],
            ] as const).map(([label, n, flow]) => (
              <div key={label}>
                <dt>{flow && <span className="dot" data-tone={STORE_FLOW[flow].tone === "neutral" ? undefined : STORE_FLOW[flow].tone} aria-hidden />}{label}</dt>
                <dd>{fmtInt(n)}</dd>
              </div>
            ))}
          </dl>
          <p className="panel-note muted">
            Primera tienda {pct(conc.top1)} · 3 primeras {pct(conc.top3)} · 5 primeras {pct(conc.top5)} de los pedidos.
          </p>
          <StoreList rows={data.stores.top} total={data.stores.total} showCountry={multiCountry} />
        </section>

        <section className="panel" aria-labelledby="h-losing">
          <div className="panel-head">
            <h2 id="h-losing">Tiendas que se están yendo</h2>
            <span className="aside">Perdidas o cayendo, por pedidos perdidos</span>
          </div>
          {data.stores.losing.length === 0 ? (
            <p className="panel-body muted">Ninguna tienda perdida ni en caída fuerte en este período.</p>
          ) : (
            <StoreList rows={data.stores.losing} total={0} showCountry={multiCountry} showPrev />
          )}
        </section>
      </div>

      {/* Productos */}
      <section className="panel section-gap" aria-labelledby="h-products">
        <div className="panel-head">
          <h2 id="h-products">Productos{where}</h2>
          <span className="aside">Lectura: volumen del período × tendencia frente al anterior</span>
        </div>
        <div className="table-scroll panel-flush">
          <table className="table biz-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Lectura</th>
                <th className="r">Unidades</th>
                <th className="r">vs. anterior</th>
                <th className="r hide-md">Tiendas</th>
                <th className="r">Entrega</th>
                <th className="r hide-md">Neto (USD)</th>
                <th className="hide-md">También en</th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((p, i) => {
                const read = PRODUCT_READ[reads.get(p)!];
                const also = others.get(p) ?? [];
                return (
                  <tr key={`${p.account}-${p.name}-${i}`}>
                    <td>
                      <Link className="link" href={`/products?q=${encodeURIComponent(p.name)}`}>{p.name}</Link>
                      {multiCountry && <span className="muted"> · {p.country}</span>}
                    </td>
                    <td><span className="pill" data-tone={read.tone} title={read.hint}>{read.label}</span></td>
                    <td className="num">{fmtInt(p.units)}</td>
                    <td className="num"><Delta cur={p.units} prev={p.prev_units} /></td>
                    <td className="num hide-md">{fmtInt(p.stores)}</td>
                    <td className="num">{pct(deliveryRate(p.delivered, p.failed))}</td>
                    <td className="num hide-md">{usd(p.vendor_usd)}</td>
                    <td className="hide-md muted">{also.length ? also.join(", ") : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="panel-note muted">
          {Object.values(PRODUCT_READ).map((r) => `${r.label}: ${r.hint.charAt(0).toLowerCase()}${r.hint.slice(1)}.`).join(" ")}
        </p>
      </section>

      {/* Operación */}
      <div className="grid-2">
        <section className="panel" aria-labelledby="h-carriers">
          <div className="panel-head">
            <h2 id="h-carriers">Paqueteras{where}</h2>
            <span className="aside">Medianas del período</span>
          </div>
          <div className="table-scroll panel-flush">
            <table className="table biz-table">
              <thead>
                <tr>
                  <th>Paquetera</th>
                  <th className="r">Pedidos</th>
                  <th className="r">Entrega</th>
                  <th className="r" title="Horas desde que llega el pedido hasta que se despacha">Despacho</th>
                  <th className="r" title="Días desde la recolección hasta la entrega (mediana y 90 %)">Entrega en</th>
                </tr>
              </thead>
              <tbody>
                {data.carriers.map((c) => (
                  <tr key={`${c.account}-${c.name}`}>
                    <td>
                      <Link className="link" href={`/orders?carrier=${encodeURIComponent(c.name)}`}>{c.name}</Link>
                      {multiCountry && <span className="muted"> · {c.country}</span>}
                    </td>
                    <td className="num">{fmtInt(c.orders)}</td>
                    <td className="num">{pct(deliveryRate(c.delivered, c.failed))}</td>
                    <td className="num">{c.h_to_dispatch === null ? "—" : `${c.h_to_dispatch} h`}</td>
                    <td className="num">
                      {c.d_to_deliver === null ? "—" : `${c.d_to_deliver} d`}
                      {c.d_to_deliver_p90 !== null && <span className="muted"> · {c.d_to_deliver_p90}{" "}d</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="panel-note muted">Entrega en: mediana y, en gris, el 90 % de los pedidos.</p>
        </section>

        <section className="panel" aria-labelledby="h-depts">
          <div className="panel-head">
            <h2 id="h-depts">Zonas con menos entrega{where}</h2>
            <span className="aside">Departamentos con 20 o más pedidos cerrados</span>
          </div>
          {data.departments.length === 0 ? (
            <p className="panel-body muted">No hay departamentos con suficientes pedidos cerrados en este período.</p>
          ) : (
            <ul className="rank panel-flush">
              {data.departments.map((d) => (
                <li key={`${d.account}-${d.name}`}>
                  <span className="name">{d.name}{multiCountry && <span className="muted"> · {d.country}</span>}</span>
                  <span className="n">{pct(d.rate)}</span>
                  <Share value={d.rate} />
                  <span className="meta">{fmtInt(d.failed)} no entregados de {fmtInt(d.closed)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function StoreList({ rows, total, showCountry, showPrev }: { rows: StoreItem[]; total: number; showCountry: boolean; showPrev?: boolean }) {
  return (
    <ul className="rank panel-flush">
      {rows.map((s) => {
        const flow = STORE_FLOW[s.flow];
        return (
          <li key={`${s.account}-${s.name}`}>
            <Link className="name link" href={`/orders?dropshipper=${encodeURIComponent(s.name)}`} style={{ color: "inherit", fontWeight: 500 }}>
              {s.name}{showCountry && <span className="muted"> · {s.country}</span>}
            </Link>
            <span className="n"><span className="pill" data-tone={flow.tone}>{flow.label}</span></span>
            {total > 0 && <Share value={s.cur / total} />}
            <span className="meta">
              {showPrev
                ? `${fmtInt(s.cur)} pedidos frente a ${fmtInt(s.prev)} en el período anterior`
                : <>{fmtInt(s.cur)} pedidos · {pct(total ? s.cur / total : null)} del total · <Delta cur={s.cur} prev={s.prev} /></>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
