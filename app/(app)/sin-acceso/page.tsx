import Link from "next/link";
import { IconLock } from "@/components/icons";
import { requireUser } from "@/lib/auth";
import { isPermission, permissionLabel } from "@/lib/permissions";

export const metadata = { title: "Sin acceso" };

export default async function NoAccessPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  await requireUser();
  const { p } = await searchParams;
  const section = isPermission(p) ? permissionLabel(p) : null;
  return (
    <div className="page page-narrow">
      <section className="panel">
        <div className="empty no-access">
          <span className="no-access-icon" aria-hidden><IconLock /></span>
          <h3>{section ? `No tienes acceso a ${section}` : "No tienes acceso a esta sección"}</h3>
          <p>Si lo necesitas, pídele a quien administra Usuarios que te active ese permiso.</p>
          <Link className="btn" href="/">Ir a Inicio</Link>
        </div>
      </section>
    </div>
  );
}
