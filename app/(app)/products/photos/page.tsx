import { redirect } from "next/navigation";

// Las fotos reales ahora se abren desde el catálogo (la miniatura de cada producto).
// Esta dirección queda para enlaces viejos: lleva al catálogo con el filtro de fotos.
export default async function PhotosPage({ searchParams }: { searchParams: Promise<{ q?: string; f?: string }> }) {
  const sp = await searchParams;
  const s = new URLSearchParams();
  if (sp.q) s.set("q", sp.q.slice(0, 100));
  s.set("ph", sp.f === "sin" ? "sin" : "con");
  redirect(`/products?${s}`);
}
