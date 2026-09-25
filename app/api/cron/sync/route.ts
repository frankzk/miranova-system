import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/auth";
import { syncAll } from "@/lib/sync";

// Vercel Cron llama aquí cada 10 minutos (ver vercel.json) con
// "Authorization: Bearer <CRON_SECRET>". Sincroniza todas las cuentas activas.

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!cronSecret || !safeEqual(auth, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const results = await syncAll();
  return NextResponse.json({ ok: true, results });
}
