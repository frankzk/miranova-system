import type { NextRequest } from "next/server";
import { authorizeRouteAny } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { signedTransferRead } from "@/lib/transfers-data";

// Documento de un traslado (manifiesto, fotos de llegada): revisa el permiso de Compras y redirige a un enlace
// firmado de Storage de pocos minutos. ?dl=1 lo baja como archivo.

const TTL_S = 600;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeRouteAny("imports", "imports_view");
  if (user instanceof Response) return user;
  const id = (await params).id;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "No existe" }, { status: 404 });
  const { data } = await db().from("transfer_documents").select("storage_path, filename").eq("id", id).maybeSingle();
  const doc = data as { storage_path: string; filename: string | null } | null;
  if (!doc) return Response.json({ error: "No existe" }, { status: 404 });
  const dl = req.nextUrl.searchParams.get("dl") === "1";
  const url = await signedTransferRead(doc.storage_path, TTL_S, dl ? (doc.filename ?? "documento").replace(/[^\w.\- ]+/g, "_") : undefined);
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}
