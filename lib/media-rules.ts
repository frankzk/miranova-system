// Reglas del repositorio de fotos y videos reales de productos. Sin base de datos ni Next, para
// usarlas en servidor, en el navegador (validar antes de subir) y en pruebas.

/** Tipos que acepta el bucket product-media (igual que en la migración 0023). */
export const MEDIA_TYPES: Record<string, { kind: "photo" | "video"; ext: string }> = {
  "image/jpeg": { kind: "photo", ext: "jpg" },
  "image/png": { kind: "photo", ext: "png" },
  "image/webp": { kind: "photo", ext: "webp" },
  "image/gif": { kind: "photo", ext: "gif" },
  "video/mp4": { kind: "video", ext: "mp4" },
  "video/quicktime": { kind: "video", ext: "mov" },
  "video/webm": { kind: "video", ext: "webm" },
};

export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 20;
export const MEDIA_ACCEPT = Object.keys(MEDIA_TYPES).join(",");

/** Algunos navegadores no informan el tipo (p. ej. .mov en Windows): se deduce de la extensión. */
export function mediaType(type: string, filename: string): string | null {
  const t = type.toLowerCase();
  if (MEDIA_TYPES[t]) return t;
  const ext = filename.toLowerCase().split(".").pop();
  const byExt: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };
  return !t || t === "application/octet-stream" ? (ext && byExt[ext]) || null : null;
}

/** Problema con un archivo antes de subirlo, o null si sirve. */
export function mediaProblem(type: string, filename: string, size: number): string | null {
  if (!mediaType(type, filename)) return `${filename}: solo fotos JPG, PNG, WEBP o GIF y videos MP4, MOV o WEBM.`;
  if (!(size > 0)) return `${filename}: el archivo está vacío.`;
  if (size > MAX_MEDIA_BYTES) return `${filename}: pesa más de 50 MB.`;
  return null;
}

/**
 * Clave con que se agrupan las fotos: el SKU, compartido entre países (el mismo producto en Drop
 * Honduras y Drop Guatemala ve las mismas fotos). Sin SKU, el producto de esa cuenta.
 */
export function mediaKey(p: { sku?: string | null; account_id: string; external_id: string }): string {
  const sku = p.sku?.trim().toUpperCase();
  return sku ? `sku:${sku}` : `id:${p.account_id}:${p.external_id}`;
}

export const isMediaKey = (k: unknown): k is string => typeof k === "string" && /^(sku:.{1,120}|id:[0-9a-f-]{36}:.{1,120})$/.test(k);

/** Carpeta en el bucket para una clave: solo caracteres seguros para una ruta de Storage. */
export const mediaFolder = (key: string) => key.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** La ruta que el servidor le dio a esa clave ("<carpeta>/<uuid>.<ext>"), para no registrar otra. */
export function isPathForKey(path: string, key: string): boolean {
  const folder = mediaFolder(key).replace(/[.]/g, "\\.");
  return new RegExp(`^${folder}/${UUID}\\.(jpg|png|webp|gif|mp4|mov|webm)$`).test(path);
}

/** Nombre para descargar: nombre del producto o SKU, sin caracteres raros, con la extensión real. */
export function downloadName(base: string, contentType: string, n?: number): string {
  const ext = MEDIA_TYPES[contentType]?.ext ?? "bin";
  const clean = base.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "producto";
  return `${clean}${n ? `-${n}` : ""}.${ext}`;
}

export function fmtBytes(n: number | null | undefined): string {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
