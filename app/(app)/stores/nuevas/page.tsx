import Link from "next/link";
import { AccountChips } from "@/components/account-chips";
import { GetForm } from "@/components/client";
import { IconDownload, IconMail, IconSearch } from "@/components/icons";
import { RangePicker } from "@/components/range-picker";
import { StoreDrawerLink } from "@/components/store-drawer-link";
import { StoresSubnav } from "@/components/stores-subnav";
import { PageHead } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { requirePermission } from "@/lib/auth";
import { contactKey, contactsByStore, storeProfiles } from "@/lib/contacts";
import { fmtInt, todayIn } from "@/lib/format";
import { can } from "@/lib/permissions";
import { customLabels, resolveRange } from "@/lib/ranges";
import { getScope } from "@/lib/scope";
import {
  filterSignups, localDay, periodBounds, SIGNUP_PERIODS, signupPeriod, toSignups, type SignupPeriod, type SignupRow,
} from "@/lib/signups";
import { daysBetween, fmtDay } from "@/lib/store-metrics";
import { storeKey } from "@/lib/stores";
import { loadDrawer, parseFicha, StoreDrawerSlot } from "../store-drawer-panel";
import "./nuevas.css";

export const metadata = { title: "Tiendas nuevas" };

// Cuándo entró cada tienda a vender con Miranova (su primer pedido), con su dueño y su correo,
// para cotejar referidos. Sale de los pedidos sincronizados: las tiendas nuevas aparecen solas.

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};

const monthName = (ymd: string) => new Intl.DateTimeFormat("es", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));

export default async function NewStoresPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("stores");
  const sp = await searchParams;
  const accounts = await listAccounts();
  const scope = await getScope(accounts);
  const tzOf = (id: string) => accounts.find((a) => a.id === id)?.timezone ?? scope.tz;
  const today = todayIn(scope.tz);

  const ficha = parseFicha(one(sp, "ficha"));
  const drawerData = loadDrawer(ficha);
  const [profiles, contacts] = await Promise.all([storeProfiles(), contactsByStore()]);
  const all = toSignups(
    profiles.filter((p) => !scope.account || p.account_id === scope.account),
    (p) => contacts.get(contactKey(p)),
  );

  // período: rango propio (from/to) o este mes / mes anterior / todas
  const range = { from: one(sp, "from"), to: one(sp, "to") };
  const { period, custom, bounds } = signupPeriod({ p: one(sp, "p"), ...range }, today);
  const boundsOf = (p: SignupPeriod) => periodBounds(p, today);
  const q = one(sp, "q")?.slice(0, 80);

  const rows = filterSignups(all, { ...bounds, q }, tzOf);
  const count = (p: SignupPeriod) => filterSignups(all, { ...boundsOf(p), q }, tzOf).length;
  const withEmail = rows.filter((r) => r.email).length;
  const showAccount = !scope.account && accounts.length > 1;
  const canEdit = can(user, "stores_edit");

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q, p: period === "rango" || period === "todas" ? undefined : period, from: custom?.from, to: custom?.to, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return p.toString();
  };
  const href = (patch: Record<string, string | undefined>) => {
    const s = qs(patch);
    return s ? `/stores/nuevas?${s}` : "/stores/nuevas";
  };
  const periodHref = (p: SignupPeriod) => href({ p: p === "todas" ? undefined : p, from: undefined, to: undefined, ficha: undefined });
  const fichaHref = (r: SignupRow) => href({ ficha: storeKey(r) });
  const fichaRow = ficha ? all.find((r) => r.account_id === ficha.accountId && r.store_id === ficha.storeId) : undefined;
  const during =
    period === "rango" && custom ? customLabels(custom.from, custom.to, today).during
      : period === "todas" ? "desde que empezaron"
        : `en ${monthName(bounds!.from)}`;

  return (
    <div className="page">
      <PageHead
        title="Tiendas nuevas"
        sub={<>{fmtInt(all.length)} tiendas han vendido con Miranova · {scope.label} · se actualiza sola con cada sincronización</>}
      />
      <StoresSubnav />
      <AccountChips accounts={accounts} current={scope.account} next={href({ ficha: undefined })} />

      <div className="toolbar">
        <nav className="segmented" aria-label="Período de ingreso">
          {(Object.keys(SIGNUP_PERIODS) as SignupPeriod[]).map((p) => (
            <Link key={p} href={periodHref(p)} aria-current={period === p} title={p === "todas" ? undefined : `Entraron en ${monthName(boundsOf(p)!.from)}`}>
              {SIGNUP_PERIODS[p]} <span className="c">{fmtInt(count(p))}</span>
            </Link>
          ))}
        </nav>
        <RangePicker range={resolveRange(undefined, scope.tz, range)} today={today} path="/stores/nuevas" />
        <GetForm className="search ns-search" role="search" action="/stores/nuevas">
          {period !== "rango" && period !== "todas" && <input type="hidden" name="p" value={period} />}
          {custom && <><input type="hidden" name="from" value={custom.from} /><input type="hidden" name="to" value={custom.to} /></>}
          <label className="input-icon">
            <span className="sr-only">Buscar</span>
            <IconSearch />
            <input className="input" type="search" name="q" defaultValue={q} placeholder="Tienda, dueño o correo" />
          </label>
          <button className="btn" type="submit">Buscar</button>
          {q && <Link className="btn btn-ghost" href={href({ q: undefined, ficha: undefined })}>Limpiar</Link>}
        </GetForm>
        {can(user, "export") && (
          <>
            <span className="spacer" />
            <a className="btn" href={`/api/export/stores/nuevas${qs({ ficha: undefined }) ? `?${qs({ ficha: undefined })}` : ""}`} download title="Descargar este listado en Excel">
              <IconDownload /> Exportar a Excel
            </a>
          </>
        )}
      </div>

      <p className="ns-summary">
        <b>{fmtInt(rows.length)}</b> {rows.length === 1 ? "tienda entró" : "tiendas entraron"} {during}
        {rows.length > 0 && <> · {fmtInt(withEmail)} con correo</>}
      </p>

      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty">
            <h3>{q ? `Ninguna tienda coincide con “${q}”` : "Ninguna tienda entró en este período"}</h3>
            <p>{q ? "Busca por una parte del nombre de la tienda, del dueño o del correo." : "Prueba con otro período o con Todas."}</p>
          </div>
        ) : (
          <>
            <ul className="ns-cards only-sm">
              {rows.map((r) => (
                <li key={storeKey(r)}>
                  <div className="top">
                    <StoreDrawerLink className="strong" href={fichaHref(r)} name={r.name}>{r.name}</StoreDrawerLink>
                    <span className="ns-date">{fmtDay(localDay(r.first_at, tzOf(r.account_id)), today)}</span>
                  </div>
                  {showAccount && <div className="sub">{r.account_name}</div>}
                  <dl>
                    <div><dt>Dueño</dt><dd><Owner r={r} /></dd></div>
                    <div><dt>Correo</dt><dd><Email r={r} addHref={canEdit ? fichaHref(r) : null} /></dd></div>
                  </dl>
                </li>
              ))}
            </ul>

            <div className="table-scroll not-sm">
              <table className="table ns-table">
                <thead>
                  <tr>
                    <th title="Primer pedido de la tienda con Miranova">Ingreso</th>
                    <th>Tienda</th>
                    <th>Dueño</th>
                    <th>Correo de la tienda</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const day = localDay(r.first_at, tzOf(r.account_id));
                    const ago = daysBetween(day, localDay(new Date().toISOString(), tzOf(r.account_id)));
                    return (
                      <tr key={storeKey(r)}>
                        <td className="ns-when">
                          <span className="strong">{fmtDay(day, today)}</span>
                          <div className="sub">{ago === 0 ? "hoy" : ago === 1 ? "ayer" : `hace ${fmtInt(ago)} días`}</div>
                        </td>
                        <td>
                          <StoreDrawerLink className="strong store-name" href={fichaHref(r)} name={r.name}>{r.name}</StoreDrawerLink>
                          {showAccount && <div className="sub">{r.account_name}</div>}
                        </td>
                        <td><Owner r={r} /></td>
                        <td><Email r={r} addHref={canEdit ? fichaHref(r) : null} /></td>
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
          name={fichaRow?.name}
          closeHref={href({ ficha: undefined })}
          me={user.name}
          canOrders={can(user, "orders")}
          canEdit={canEdit}
        />
      )}

      <p className="footnote">
        El ingreso es el primer pedido de la tienda con Miranova. El dueño es el nombre registrado en Drop. Drop no manda el correo de la tienda: se toma el que la tienda repite en sus pedidos
        (3 clientes o más) o el que se guarde en su contacto, que tiene prioridad. Si falta, ábrela y agrégalo en Contacto.
      </p>
    </div>
  );
}

function Owner({ r }: { r: SignupRow }) {
  if (!r.person) return <span className="subtle">—</span>;
  return (
    <>
      {r.person}
      {r.contactOwner && <div className="sub" title="Responsable anotado en el contacto de la tienda">Contacto: {r.contactOwner}</div>}
    </>
  );
}

function Email({ r, addHref }: { r: SignupRow; addHref: string | null }) {
  if (!r.email) {
    return addHref ? (
      <StoreDrawerLink className="ns-add" href={addHref} name={r.name} title="Abrir la tienda para agregar su correo en Contacto">Agregar correo</StoreDrawerLink>
    ) : (
      <span className="subtle">Sin correo</span>
    );
  }
  return (
    <>
      <a className="ns-mail" href={`mailto:${r.email}`}><IconMail /> {r.email}</a>
      {r.emailSource === "pedidos" && <div className="sub" title="Drop no manda el correo de la tienda: es el que la tienda pone en sus pedidos">detectado en los pedidos</div>}
    </>
  );
}
