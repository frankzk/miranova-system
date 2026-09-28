import "server-only";
import { db } from "./supabase";
import { isPathForKey, MAX_MEDIA_BYTES, mediaFolder, MEDIA_TYPES } from "./media-rules";

// Repositorio privado de fotos y videos reales de productos, para uso interno del equipo.
// Los archivos viven en el bucket privado "product-media" de Supabase Storage; nunca hay un
// enlace público: el navegador pide /api/media/<id>, que revisa el permiso y redirige a un
// enlace firmado de pocos minutos. La tabla product_media guarda a qué producto pertenece cada uno.

export const BUCKET = "product-media";

export type MediaItem = {
  id: string;
  media_key: string;
  storage_path: string;
  kind: "photo" | "video";
  content_type: string;
  size_bytes: number | null;
  filename: string | null;
  caption: string | null;
  uploaded_by: string | null;
  created_at: string;
};

const COLS = "id, media_key, storage_path, kind, content_type, size_bytes, filename, caption, uploaded_by, created_at";

/** Todas las fotos y videos, del más antiguo al más nuevo (la primera foto es la portada). */
export async function listMedia(): Promise<MediaItem[]> {
  const out: MediaItem[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await db().from("product_media").select(COLS).order("created_at").range(from, from + 999);
    if (error) throw error;
    out.push(...(data as MediaItem[]));
    if (data.length < 1000) break;
  }
  return out;
}

export async function getMedia(id: string): Promise<MediaItem | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await db().from("product_media").select(COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as MediaItem | null) ?? null;
}

/** Enlace firmado para subir un archivo directo a Storage desde el navegador (sin pasar por Vercel). */
export async function signedUpload(key: string, contentType: string): Promise<{ path: string; url: string }> {
  const ext = MEDIA_TYPES[contentType]?.ext;
  if (!ext) throw new Error("Tipo de archivo no permitido");
  const path = `${mediaFolder(key)}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await db().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw error ?? new Error("Storage no devolvió el enlace de subida");
  return { path, url: data.signedUrl };
}

/**
 * Registra un archivo ya subido. Toma tamaño y tipo de Storage (no del navegador) y rechaza rutas
 * que no sean de esa clave o que ya estén registradas.
 */
export async function registerMedia(input: { key: string; path: string; filename: string; caption?: string | null; userId: string }): Promise<MediaItem> {
  if (!isPathForKey(input.path, input.key)) throw new Error("Ruta de archivo no válida");
  const { data: info, error: infoErr } = await db().storage.from(BUCKET).info(input.path);
  if (infoErr || !info) throw new Error("El archivo no llegó a guardarse; vuelve a subirlo.");
  const contentType = String(info.contentType ?? "").toLowerCase();
  const type = MEDIA_TYPES[contentType];
  const size = Number(info.size ?? 0);
  if (!type || size > MAX_MEDIA_BYTES) {
    await db().storage.from(BUCKET).remove([input.path]);
    throw new Error("Tipo o tamaño de archivo no permitido");
  }
  const { data, error } = await db()
    .from("product_media")
    .insert({
      media_key: input.key,
      storage_path: input.path,
      kind: type.kind,
      content_type: contentType,
      size_bytes: size || null,
      filename: input.filename.slice(0, 200) || null,
      caption: input.caption?.trim().slice(0, 200) || null,
      uploaded_by: input.userId,
      created_at: new Date().toISOString(),
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return data as MediaItem;
}

export async function updateCaption(id: string, caption: string): Promise<void> {
  const { error } = await db().from("product_media").update({ caption: caption.trim().slice(0, 200) || null }).eq("id", id);
  if (error) throw error;
}

/** Borra el archivo de Storage y su registro. */
export async function deleteMedia(item: MediaItem): Promise<void> {
  const { error: sErr } = await db().storage.from(BUCKET).remove([item.storage_path]);
  if (sErr) throw sErr;
  const { error } = await db().from("product_media").delete().eq("id", item.id);
  if (error) throw error;
}

/** Enlace firmado de lectura (o de descarga, con el nombre dado). */
export async function signedRead(item: MediaItem, seconds: number, download?: string): Promise<string> {
  const { data, error } = await db().storage.from(BUCKET).createSignedUrl(item.storage_path, seconds, download ? { download } : undefined);
  if (error || !data) throw error ?? new Error("Storage no devolvió el enlace");
  return data.signedUrl;
}
