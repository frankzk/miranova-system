import Link from "next/link";
import { IconChevronRight } from "@/components/icons";
import { describeAlert, type OwnerAlerts } from "@/lib/alerts";
import { fmtInt } from "@/lib/format";

/** Bloque "Atención del dueño": máximo 10 hallazgos del día, del más grave al menos grave. */
export function OwnerAlertsPanel({ data, tz }: { data: OwnerAlerts; tz: string }) {
  const shown = data.alerts.length;
  return (
    <section className="panel owner-alerts" aria-labelledby="owner-alerts-title">
      <div className="panel-head">
        <h2 id="owner-alerts-title">Atención del dueño</h2>
        <span className="aside">
          {shown === 0 ? "Sin hallazgos" : data.total > shown ? `${fmtInt(shown)} de ${fmtInt(data.total)} hallazgos` : `${fmtInt(shown)} ${shown === 1 ? "hallazgo" : "hallazgos"}`}
        </span>
      </div>
      {shown === 0 ? (
        <p className="panel-body muted">Nada fuera de lo normal: sin caídas fuertes, pedidos estancados ni rechazos por falta de stock.</p>
      ) : (
        <ul className="alert-list panel-flush">
          {data.alerts.map((a, i) => {
            const v = describeAlert(a, tz);
            const body = (
              <>
                <span className="text">
                  <span className="t">{v.title}</span>
                  <span className="s">{v.detail}</span>
                </span>
                <span className="pill" data-tone={v.tone}>{v.tag}</span>
                <IconChevronRight className="go" aria-hidden />
              </>
            );
            // los enlaces que cambian la cuenta activa pasan por /api/scope: <a> normal, sin precarga
            return (
              <li key={`${a.kind}-${a.account_id}-${i}`}>
                {v.href.startsWith("/api/") ? (
                  <a href={v.href} data-tone={v.tone}>{body}</a>
                ) : (
                  <Link href={v.href} data-tone={v.tone}>{body}</Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
