import { PageSkeleton } from "@/components/page-skeleton";

// Entre las pestañas de Ajustes (cuentas, usuarios, correo).
export default function Loading() {
  return <PageSkeleton kpis={false} rows={5} />;
}
