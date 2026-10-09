import { PageSkeleton } from "@/components/page-skeleton";

// Respuesta inmediata al cambiar de sección: sin esto, el clic no muestra nada hasta que el
// servidor termina de armar la página completa.
export default function Loading() {
  return <PageSkeleton />;
}
