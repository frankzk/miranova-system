import { toneOf } from "@/lib/status";

export function StatusPill({ code, label }: { code: string | null; label: string | null }) {
  if (!label && !code) return <span className="subtle">—</span>;
  return <span className="pill" data-tone={toneOf(code, label)}>{label ?? code}</span>;
}

export function PageHead({
  title,
  sub,
  actions,
  crumbs,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  crumbs?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {crumbs && <div className="crumbs">{crumbs}</div>}
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

/** Texto de ciudad + departamento. */
export const place = (city: string | null, dept: string | null) => [city, dept].filter(Boolean).join(", ");
