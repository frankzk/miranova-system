import Link from "next/link";
import { RowLink } from "@/components/client";
import { IconPlus } from "@/components/icons";
import { NewImportForm } from "@/components/import-forms";
import { ImportsSubnav } from "@/components/imports-subnav";
import { SideSheet } from "@/components/side-sheet";
import { PageHead } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { requirePermission } from "@/lib/auth";
import { countryByCode, COUNTRIES } from "@/lib/countries";
import { fmtInt, fmtMoney, todayIn } from "@/lib/format";
import { ARRIVED, isActive, isLate, needsReport, staleDays, statusInfo, trackingUrl } from "@/lib/imports";
import { listImports, listSuppliers } from "@/lib/imports-data";
import { can } from "@/lib/permissions";
import { createImport } from "./actions";
import "./imports.css";

export const metadata = { title: "Importaciones" };

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};

const VIEWS = [
  { id: "activas", label: "Activas", test: (s: string) => isActive(s) },
  { id: "recibidas", label: "Recibidas", test: (s: string) => (ARRIVED as string[]).includes(s) },
  { id: "canceladas", label: "Canceladas", test: (s: string) => s === "cancelled" },
  { id: "todas", label: "Todas", test: () => true },
] as const;

/** "14 oct" */
const shortDay = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("es-HN", { day: "numeric", month: "short", timeZone: "UTC" }) : "—");

export default async function ImportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [user, accounts, all, suppliers, sp] = await Promise.all([requirePermission("imports"), listAccounts(), listImports(), listSuppliers(), searchParams]);
  const money = can(user, "money");
  const today = todayIn();
  const view = VIEWS.find((v) => v.id === one(sp, "v")) ?? VIEWS[0];
  const country = one(sp, "c");
  const supplierId = one(sp, "s");
  const supplierName = supplierId ? suppliers.find((x) => x.id === supplierId)?.name ?? "proveedor" : null;
  const inScope = (r: (typeof all)[number]) => (!country || r.dest_country === country) && (!supplierId || r.supplier_id === supplierId);
  const rows = all.filter((r) => view.test(r.status) && inScope(r));

  // países: primero los de las cuentas (y los que ya tienen importaciones), luego el resto
  const mine = [...new Set([...accounts.map((a) => a.country), ...all.map((r) => r.dest_country)])];
  const countries = [...mine.map((c) => countryByCode(c)).filter((c): c is NonNullable<typeof c> => Boolean(c)), ...COUNTRIES.filter((c) => !mine.includes(c.code))]
    .map((c) => ({ code: c.code, name: c.name }));
  const defaultCountry = all[0]?.dest_country ?? accounts.find((a) => a.enabled && !a.catalog_only)?.country ?? "GT";
  const used = [...new Set(all.map((r) => r.dest_country))];
  const active = all.filter((r) => isActive(r.status));
  const inTransit = active.reduce((t, r) => t + r.total, 0);
  const toReport = active.filter((r) => needsReport(r, today)).length;
  const lateCount = active.filter((r) => isLate(r, today)).length;
  const staleCount = active.filter((r) => staleDays(r, r.last_event_at, today) !== null).length;
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { v: view.id === "activas" ? undefined : view.id, c: country, s: supplierId, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/imports?${s}` : "/imports";
  };

  return (
    <div className="page im-page">
      <PageHead
        title="Importaciones"
        sub={<>
          {fmtInt(active.length)} {active.length === 1 ? "activa" : "activas"}
          {money && active.length > 0 && <> · {fmtMoney(inTransit, "USD")} en camino</>}
          {toReport > 0 && <> · <span className="im-alert-text">{toReport} sin avisar a la bodega</span></>}
          {lateCount > 0 && <> · <span className="im-alert-text">{lateCount} {lateCount === 1 ? "atrasada" : "atrasadas"}</span></>}
          {staleCount > 0 && <> · <span className="im-warn-text">{staleCount} sin novedades</span></>}
        </>}
        actions={
          <SideSheet trigger={<><IconPlus /> Nueva importación</>} triggerClass="btn btn-primary" title="Nueva importación" sub="Después agregas los productos, costos y documentos">
            <NewImportForm action={createImport} countries={countries} defaultCountry={defaultCountry} suppliers={suppliers.map((s) => ({ id: s.id, name: s.name, origin: s.origin }))} />
          </SideSheet>
        }
      />
      <ImportsSubnav money={money} />

      <nav className="tabs" aria-label="Importaciones">
        {VIEWS.map((v) => (
          <Link key={v.id} href={href({ v: v.id === "activas" ? undefined : v.id })} aria-current={view.id === v.id}>
            {v.label} <span className="c">{fmtInt(all.filter((r) => v.test(r.status) && inScope(r)).length)}</span>
          </Link>
        ))}
      </nav>

      {supplierName && (
        <nav className="chips" aria-label="Proveedor">
          <Link href={href({ s: undefined })} aria-current>{supplierName} ✕</Link>
        </nav>
      )}
      {used.length > 1 && (
        <nav className="chips" aria-label="País destino">
          <Link href={href({ c: undefined })} aria-current={!country}>Todos los países</Link>
          {used.map((c) => <Link key={c} href={href({ c })} aria-current={country === c}>{countryByCode(c)?.name ?? c}</Link>)}
        </nav>
      )}

      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty">
            <h3>{all.length ? "Nada en esta vista" : "Aún no hay importaciones"}</h3>
            <p>{all.length ? "Cambia de pestaña o de país." : "Crea la primera con “Nueva importación”: país destino, proveedor y guía; luego sus productos y costos."}</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table stack im-table">
              <thead>
                <tr>
                  <th>Importación</th>
                  <th>Destino</th>
                  <th>Estado</th>
                  <th className="r">Unidades</th>
                  <th>Llega</th>
                  <th className="hide-md">Guía</th>
                  <th>Bodega</th>
                  {money && <th className="r">Costo total</th>}
                  {money && <th className="r hide-md">Pagado</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = statusInfo(r.status);
                  const late = isActive(r.status) && r.eta !== null && r.eta < today;
                  const link = trackingUrl(r.carrier, r.tracking_number, r.tracking_url);
                  const alert = needsReport(r, today);
                  const stale = staleDays(r, r.last_event_at, today);
                  return (
                    <RowLink key={r.id} href={`/imports/${r.id}`}>
                      <td data-slot="id">
                        <Link className="order-no" href={`/imports/${r.id}`}>{r.code}</Link>
                        <div className="sub clip">{r.supplier ?? "Sin proveedor"}</div>
                      </td>
                      <td className="nowrap">{countryByCode(r.dest_country)?.name ?? r.dest_country}</td>
                      <td data-slot="status">
                        <span className="pill" data-tone={st.tone}>{st.label}</span>
                        {stale !== null && <div className="sub im-warn-text">sin novedades hace {stale} días</div>}
                      </td>
                      <td className="num">{fmtInt(r.units)}<div className="sub">{r.lines} {r.lines === 1 ? "producto" : "productos"}</div></td>
                      <td className="nowrap">
                        {r.arrived_at ? <>Llegó {shortDay(r.arrived_at)}</> : <span className={late ? "im-alert-text" : undefined}>{shortDay(r.eta)}{late && " · atrasada"}</span>}
                      </td>
                      <td className="hide-md nowrap">
                        {r.tracking_number ? (link ? <a href={link} target="_blank" rel="noreferrer">{[r.carrier, r.tracking_number].filter(Boolean).join(" ")}</a> : r.tracking_number) : <span className="subtle">—</span>}
                      </td>
                      <td className="nowrap">
                        {r.reported_at ? <span className="pill" data-tone="success">Reportada</span> : alert ? <span className="pill" data-tone="danger">Avisar</span> : <span className="subtle">—</span>}
                      </td>
                      {money && <td className="num strong">{fmtMoney(r.total, "USD")}</td>}
                      {money && <td className="num hide-md">{fmtMoney(r.paid, "USD")}{r.total > 0 && r.paid + 0.005 < r.total && <div className="sub">falta {fmtMoney(r.total - r.paid, "USD")}</div>}</td>}
                    </RowLink>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
