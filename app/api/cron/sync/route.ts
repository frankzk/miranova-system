import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/auth";
import { extractOrders } from "@/lib/normalize";
import { ingestPayload } from "@/lib/store";

// Sincronización automática opcional (Vercel Cron).
//
// Requiere conocer el endpoint interno de Drop y un token válido:
//   DROP_API_ORDERS_URL  ej. https://api.soydrop.com/vendor/orders?page={page}&limit=50
//   DROP_AUTH_HEADER     ej. "Bearer eyJhbGciOi..."  (se copia de DevTools → Network)
// Si no están configurados, el endpoint no hace nada.

export const maxDuration = 60;

const MAX_PAGES = 20;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!cronSecret || !safeEqual(auth, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const template = process.env.DROP_API_ORDERS_URL;
  const dropAuth = process.env.DROP_AUTH_HEADER;
  if (!template || !dropAuth) {
    return NextResponse.json({ skipped: "DROP_API_ORDERS_URL / DROP_AUTH_HEADER no configurados" });
  }

  let saved = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = template.replace("{page}", String(page));
    const res = await fetch(url, {
      headers: { authorization: dropAuth, accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Drop respondió ${res.status} (¿token vencido?)`, page, saved },
        { status: 502 },
      );
    }
    const payload = await res.json();
    const found = extractOrders(payload).length;
    saved += await ingestPayload(payload, "cron", url);
    // si la URL no pagina o ya no hay más pedidos, terminamos
    if (found === 0 || !template.includes("{page}")) break;
  }

  return NextResponse.json({ ok: true, saved });
}
