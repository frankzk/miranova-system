import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/auth";

// TEMPORAL: lee el JavaScript público de la web de Drop para descubrir qué
// endpoints usa (login, órdenes). No inicia sesión ni envía credenciales.

const ALLOWED = /(^|\.)soydrop\.com$|(^|\.)dropi\.(co|com)$/i;

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret || !safeEqual(req.nextUrl.searchParams.get("key") ?? "", secret)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const start = req.nextUrl.searchParams.get("url") ?? "https://app.soydrop.com/login";
  const startUrl = new URL(start);
  if (!ALLOWED.test(startUrl.hostname)) return NextResponse.json({ error: "host no permitido" }, { status: 400 });

  const ua = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36" };
  const page = await fetch(startUrl, { headers: ua, redirect: "follow" });
  const html = await page.text();

  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => new URL(m[1], page.url).toString());
  const found = new Set<string>();
  const pattern =
    /["'`](https?:\/\/[^"'`\s]{4,200}|\/(?:api|v\d|auth|vendor|vendors|orders|order|login|users?|supplier|providers?)[^"'`\s]{0,150})["'`]/gi;
  const keyword = /api|auth|login|order|orden|vendor|supplier|token|graphql|supabase|firebase/i;

  const scanned: { url: string; status: number; size: number }[] = [];
  for (const src of scripts.slice(0, 40)) {
    try {
      const r = await fetch(src, { headers: ua });
      const js = await r.text();
      scanned.push({ url: src, status: r.status, size: js.length });
      for (const m of js.matchAll(pattern)) if (keyword.test(m[1])) found.add(m[1]);
      // también variables de entorno embebidas (NEXT_PUBLIC_*, VITE_*, REACT_APP_*)
      for (const m of js.matchAll(/(NEXT_PUBLIC_|VITE_|REACT_APP_)[A-Z0-9_]+["']?\s*[:=]\s*["']([^"']{1,200})["']/g)) {
        found.add(`${m[0].slice(0, 250)}`);
      }
    } catch (e) {
      scanned.push({ url: src, status: -1, size: 0 });
    }
  }

  return NextResponse.json({
    page: { url: page.url, status: page.status, htmlHead: html.slice(0, 1500) },
    scanned,
    endpoints: [...found].sort(),
  });
}
