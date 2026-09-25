import { NextResponse, type NextRequest } from "next/server";
import { isValidIngestKey } from "@/lib/auth";
import { ingestPayload } from "@/lib/store";

// Recibe las respuestas JSON de Drop que captura la extensión de Chrome.
// Body: { url: string, payload: unknown } o { batch: [{ url, payload }] }

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

  let body: Capture & { batch?: Capture[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400, headers: CORS });
  }

  const captures = Array.isArray(body.batch) ? body.batch : [body];
  let saved = 0;
  try {
    for (const c of captures) {
      if (c.payload === undefined) continue;
      saved += await ingestPayload(c.payload, "extension", c.url ?? null);
    }
  } catch (e) {
    console.error("ingest error", e);
    return NextResponse.json({ error: "Error guardando pedidos" }, { status: 500, headers: CORS });
  }

  return NextResponse.json({ ok: true, saved }, { headers: CORS });
}
