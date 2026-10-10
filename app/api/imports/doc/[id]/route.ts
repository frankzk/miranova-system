import type { NextRequest } from "next/server";
import { authorizeRoute } from "@/lib/auth";
import { MONEY_DOCS, type DocKind } from "@/lib/imports";
import { signedRead } from "@/lib/imports-data";
import { can } from "@/lib/permissions";
import { db } from "@/lib/supabase";

// Documento de una importación: revisa el permiso (Importaciones; factura y comprobantes, además
// Dinero) y redirige a un enlace firmado de Storage de pocos minutos. ?dl=1 lo baja como archivo.

const TTL_S = 600;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeRoute("imports");
  if (user instanceof Response) return user;
  const id = (await params).id;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "No existe" }, { status: 404 });
  const { data } = await db().from("import_documents").select("kind, storage_path, filename").eq("id", id).maybeSingle();
  const doc = data as { kind: DocKind; storage_path: string; filename: string | null } | null;
  if (!doc) return Response.json({ error: "No existe" }, { status: 404 });
  if (MONEY_DOCS.includes(doc.kind) && !can(user, "money")) return Response.json({ error: "Sin permiso" }, { status: 403 });
  const dl = req.nextUrl.searchParams.get("dl") === "1";
  const url = await signedRead(doc.storage_path, TTL_S, dl ? (doc.filename ?? "documento").replace(/[^\w.\- ]+/g, "_") : undefined);
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}
