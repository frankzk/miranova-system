import { authorizeRoute } from "@/lib/auth";
import { BANK_BUCKET, UUID } from "@/lib/reconciliation";
import { db } from "@/lib/supabase";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await authorizeRoute("reconciliation");
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!UUID.test(id))
    return Response.json({ error: "No existe" }, { status: 404 });
  const { data, error } = await db()
    .from("bank_entries")
    .select("document_path")
    .eq("id", id)
    .maybeSingle();
  if (error)
    return Response.json(
      { error: "No se pudo consultar el documento" },
      { status: 500 },
    );
  if (!data?.document_path)
    return Response.json({ error: "No existe" }, { status: 404 });
  const signed = await db()
    .storage.from(BANK_BUCKET)
    .createSignedUrl(data.document_path, 120);
  if (signed.error || !signed.data)
    return Response.json({ error: "No se pudo abrir el PDF" }, { status: 503 });
  return new Response(null, {
    status: 302,
    headers: {
      Location: signed.data.signedUrl,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
