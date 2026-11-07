import { authorizeRoute } from "@/lib/auth";
import { requestProductRow, signedPhotoRead } from "@/lib/store-requests-data";

// Foto de un producto nuevo de Solicitudes (privada: se sirve con un enlace firmado que vence).

const TTL_S = 3600;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeRoute("requests");
  if (user instanceof Response) return user;
  const id = (await params).id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return Response.json({ error: "No existe" }, { status: 404 });
  const path = (await requestProductRow(id))?.photo_path;
  if (!path) return Response.json({ error: "No existe" }, { status: 404 });
  const url = await signedPhotoRead(path, TTL_S);
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": `private, max-age=${TTL_S - 600}`, "Referrer-Policy": "no-referrer" } });
}
