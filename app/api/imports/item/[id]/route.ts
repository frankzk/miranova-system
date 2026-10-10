import { authorizeRoute } from "@/lib/auth";
import { signedRead } from "@/lib/imports-data";
import { db } from "@/lib/supabase";

// Foto subida de un producto nuevo de una importación (las del catálogo vienen de Drop).

const TTL_S = 3600;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeRoute("imports");
  if (user instanceof Response) return user;
  const id = (await params).id;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "No existe" }, { status: 404 });
  const { data } = await db().from("import_items").select("photo_path").eq("id", id).maybeSingle();
  const path = (data as { photo_path: string | null } | null)?.photo_path;
  if (!path) return Response.json({ error: "No existe" }, { status: 404 });
  const url = await signedRead(path, TTL_S);
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": `private, max-age=${TTL_S - 600}`, "Referrer-Policy": "no-referrer" } });
}
