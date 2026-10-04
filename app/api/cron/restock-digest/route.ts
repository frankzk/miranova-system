import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/passwords";
import { runRestockDigest } from "@/lib/restock-digest-send";

// Vercel Cron llama aquí cada mañana (ver vercel.json) con "Authorization: Bearer <CRON_SECRET>".
// Envía por correo el resumen de "qué pedir hoy"; si no hay nada que pedir, no envía nada.

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!cronSecret || !safeEqual(auth, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const run = await runRestockDigest();
  return NextResponse.json(run, { status: run.ok ? 200 : 500 });
}
