import type { NextRequest } from "next/server";
import { authorizeRoute } from "@/lib/auth";
import { downloadName } from "@/lib/media-rules";
import { getMedia, signedRead } from "@/lib/product-media";

// Foto o video del repositorio privado: revisa el permiso de Productos y redirige a un enlace
// firmado de Storage que vence en una hora. ?dl=<nombre> lo baja como archivo con ese nombre.

const TTL_S = 3600;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeRoute("products");
  if (user instanceof Response) return user;
  const item = await getMedia((await params).id);
  if (!item) return Response.json({ error: "No existe" }, { status: 404 });
  const dl = req.nextUrl.searchParams.get("dl");
  const n = Number(req.nextUrl.searchParams.get("n")) || undefined;
  const url = await signedRead(item, TTL_S, dl !== null ? downloadName(dl, item.content_type, n) : undefined);
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      // el enlace firmado sirve una hora: el navegador puede reusarlo un rato sin volver a pedirlo
      "Cache-Control": dl !== null ? "private, no-store" : `private, max-age=${TTL_S - 600}`,
      "Referrer-Policy": "no-referrer",
    },
  });
}
