/**
 * Esqueleto de una sección mientras el servidor la arma (loading.tsx). Aparece apenas se hace
 * clic en el menú, en vez de dejar la página anterior quieta hasta que llegan todos los datos.
 */
export function PageSkeleton({ kpis = true, rows = 8 }: { kpis?: boolean; rows?: number }) {
  return (
    <div className="page page-skeleton" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Cargando…</span>
      <div className="page-head" aria-hidden>
        <span className="sk sk-h1" />
        <span className="sk sk-sub" />
      </div>
      {kpis && (
        <div className="sk-kpis" aria-hidden>
          {[0, 1, 2, 3].map((i) => <span key={i} className="sk sk-box" />)}
        </div>
      )}
      <div className="sk-table" aria-hidden>
        {Array.from({ length: rows }, (_, i) => <span key={i} className="sk sk-row" />)}
      </div>
    </div>
  );
}
