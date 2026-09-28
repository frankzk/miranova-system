import type { NextRequest } from "next/server";
import { MAX_MEDIA_BYTES, MEDIA_TYPES } from "@/lib/media-rules";

// Solo para desarrollo local con datos de prueba (MIRANOVA_FIXTURES=1): imita los enlaces
// firmados de Supabase Storage guardando los archivos en memoria. En Vercel no existe (404).
// /api/dev-storage/upload/<bucket>/<ruta> (PUT) y /api/dev-storage/object/<bucket>/<ruta> (GET).

type DevFile = { type: string; data: Uint8Array; created_at: string };
const files = () => ((globalThis as { __miranovaFixtureFiles?: Map<string, DevFile> }).__miranovaFixtureFiles ??= new Map());
const enabled = () => process.env.MIRANOVA_FIXTURES === "1" && !process.env.VERCEL && process.env.NODE_ENV !== "production";
const notFound = () => Response.json({ error: "No existe" }, { status: 404 });

type Ctx = { params: Promise<{ path: string[] }> };

export async function PUT(req: NextRequest, { params }: Ctx) {
  if (!enabled()) return notFound();
  const [kind, ...rest] = (await params).path;
  if (kind !== "upload" || rest.length < 2) return notFound();
  const key = rest.join("/");
  if (files().has(key)) return Response.json({ error: "The resource already exists" }, { status: 409 });
  const form = await req.formData();
  const file = [...form.values()].find((v): v is File => typeof v !== "string");
  if (!file) return Response.json({ error: "Falta el archivo" }, { status: 400 });
  if (!MEDIA_TYPES[file.type]) return Response.json({ error: "mime type not supported" }, { status: 415 });
  if (file.size > MAX_MEDIA_BYTES) return Response.json({ error: "Payload too large" }, { status: 413 });
  files().set(key, { type: file.type, data: new Uint8Array(await file.arrayBuffer()), created_at: new Date().toISOString() });
  return Response.json({ Key: key });
}

export async function GET(req: NextRequest, { params }: Ctx) {
  if (!enabled()) return notFound();
  const [kind, ...rest] = (await params).path;
  const f = kind === "object" ? files().get(rest.join("/")) : undefined;
  if (!f) return notFound();
  const download = req.nextUrl.searchParams.get("download");
  return new Response(new Blob([f.data as BlobPart], { type: f.type }), {
    headers: {
      "Content-Type": f.type,
      "Cache-Control": "private, max-age=600",
      ...(download ? { "Content-Disposition": `attachment; filename="${download.replace(/[^A-Za-z0-9._-]/g, "_")}"` } : {}),
    },
  });
}
