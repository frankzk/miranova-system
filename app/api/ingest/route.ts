import { NextResponse, type NextRequest } from "next/server";
import { isValidIngestKey } from "@/lib/auth";
import { ingestPayload } from "@/lib/store";
import { db } from "@/lib/supabase";

// Recibe las respuestas JSON de Drop que captura la extensión de Chrome.
// Respaldo de la sincronización automática.
// Body: { account_id?, url, payload } o { account_id?, batch: [{ url, payload }] }
// Si hay una sola cuenta, account_id es opcional.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-api-key",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

type Capture = { url?: string; payload?: unknown };

export async function POST(req: NextRequest) {
  if (!isValidIngestKey(req.headers.get("x-api-key"))) {
    return NextResponse.json({ error: "API key inválida" }, { status: 401, headers: CORS });
  }

  let body: Capture & { batch?: Capture[]; account_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400, headers: CORS });
  }

  let q = db().from("accounts").select("id, currency, timezone");
  if (body.account_id) q = q.eq("id", body.account_id);
  const { data: accounts, error } = await q.limit(2);
  if (error || !accounts?.length) {
    return NextResponse.json({ error: "Cuenta no encontrada: créala en Ajustes" }, { status: 400, headers: CORS });
  }
  if (accounts.length > 1) {
    return NextResponse.json({ error: "Hay varias cuentas: indica account_id" }, { status: 400, headers: CORS });
  }
  const account = accounts[0];

  const captures = Array.isArray(body.batch) ? body.batch : [body];
  let saved = 0;
  try {
    for (const c of captures) {
      if (c.payload === undefined) continue;
      saved += await ingestPayload(c.payload, "extension", c.url ?? null, account);
    }
  } catch (e) {
    console.error("ingest error", e);
    return NextResponse.json({ error: "Error guardando pedidos" }, { status: 500, headers: CORS });
  }

  return NextResponse.json({ ok: true, saved }, { headers: CORS });
}
