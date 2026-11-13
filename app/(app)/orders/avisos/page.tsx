import Link from "next/link";
import { NoticeActions } from "@/components/notice-card";
import { PageHead } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { countryByCode } from "@/lib/countries";
import { fmtInt } from "@/lib/format";
import { REMIND_DAYS, WINDOW_DAYS } from "@/lib/problem-notices";
import { noticesToday, recentSent, type IssuedNotice } from "@/lib/problem-notices-data";
import { storeHref } from "@/lib/store-links";
import { markNoticeAction } from "./actions";
import "./avisos.css";

export const metadata = { title: "Avisos a tiendas" };

const when = (iso: string) => new Date(iso).toLocaleString("es-HN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Tegucigalpa" });
const countryName = (c: string) => countryByCode(c)?.name ?? c;

function Card({ g }: { g: IssuedNotice }) {
  const countries = [...new Set(g.stores.map((s) => countryName(s.country)))].join(" · ");
  const first = g.stores[0];
  return (
    <article className="panel nt-card">
      <div className="panel-head">
        <div>
          <h3>{g.title}</h3>
          <p className="sub">{[countries, g.owner_name].filter(Boolean).join(" · ")}</p>
        </div>
        <p className="nt-counts">
          {g.fresh.length > 0 && <span className="pill" data-tone="danger">{fmtInt(g.fresh.length)} {g.fresh.length === 1 ? "nuevo" : "nuevos"}</span>}
          {g.reminders.length > 0 && <span className="pill" data-tone="warning">{fmtInt(g.reminders.length)} {g.reminders.length === 1 ? "recordatorio" : "recordatorios"}</span>}
        </p>
      </div>
      <div className="panel-body nt-body">
        <pre className="nt-message">{g.message}</pre>
        <NoticeActions action={markNoticeAction} batch={g.batch_id} message={g.message} groupUrl={g.group_url} storeLink={first ? storeHref(first.account_id, first.store_id) : null} />
      </div>
    </article>
  );
}

export default async function NoticesPage() {
  const me = await requirePermission("orders");
  const [today, sent] = await Promise.all([noticesToday(), recentSent(25)]);
  const total = today.groups.length + today.missing.length;
  return (
    <div className="page">
      <p className="nt-back"><Link href="/orders">← Órdenes</Link></p>
      <PageHead
        title="Avisos a tiendas"
        sub={
          !today.ready ? "Falta activar los avisos en la base de datos."
            : total ? <>{fmtInt(total)} {total === 1 ? "aviso" : "avisos"} de pedidos con Problemas en gestión para mandar hoy</>
              : "Hoy no hay avisos pendientes."
        }
        actions={me.is_owner && <Link className="btn btn-ghost" href="/settings/integrations">Conectar un asistente</Link>}
      />
      <p className="nt-help">
        Un aviso por grupo de WhatsApp con los pedidos que entraron a <b>Problemas en gestión</b> y no se avisaron, y un recordatorio
        de los que siguen igual {REMIND_DAYS} días después (hasta {WINDOW_DAYS} días). Lo puede mandar Grok por MCP o tú: copia el mensaje,
        pégalo en el grupo y márcalo enviado para que no se repita.
      </p>

      {today.groups.length > 0 && (
        <section className="nt-list" aria-label="Avisos con grupo de WhatsApp">
          {today.groups.map((g) => <Card key={g.batch_id} g={g} />)}
        </section>
      )}

      {today.missing.length > 0 && (
        <section className="nt-section" aria-labelledby="nt-missing">
          <h2 id="nt-missing">Sin grupo de WhatsApp <span className="sub">{fmtInt(today.missing.length)}</span></h2>
          <p className="nt-help">Estas tiendas tienen pedidos para avisar pero no tienen el enlace de su grupo en el panel. Cárgalo en la ficha de la tienda o manda el mensaje por otro lado y márcalo enviado.</p>
          <div className="nt-list">
            {today.missing.map((g) => <Card key={g.batch_id} g={g} />)}
          </div>
        </section>
      )}

      {sent.length > 0 && (
        <section className="nt-section" aria-labelledby="nt-sent">
          <h2 id="nt-sent">Enviados</h2>
          <div className="table-wrap">
            <div className="table-scroll">
              <table className="table stack nt-sent">
                <thead><tr><th>Grupo</th><th className="r">Pedidos</th><th>Cuándo</th><th>Quién</th></tr></thead>
                <tbody>
                  {sent.map((s) => (
                    <tr key={s.id}>
                      <td data-slot="id" className="strong">{s.title}</td>
                      <td className="num" data-label="Pedidos">{fmtInt(s.orders)}</td>
                      <td className="nowrap">{when(s.sent_at)}</td>
                      <td>{s.sent_by ?? "—"}<span className="sub"> · {s.sent_via === "mcp" ? "asistente" : "a mano"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
