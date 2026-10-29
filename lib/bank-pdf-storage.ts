import "server-only";
import {
  BANK_BUCKET,
  MAX_BANK_PDF,
  UUID,
  type Company,
} from "./reconciliation";
import { db } from "./supabase";

/** Verifica el propietario, el tipo, el tamaño real y la firma del PDF antes de leerlo. */
export async function uploadedBankPdf(
  company: Company,
  userId: string,
  path: string,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; msg: string }> {
  const prefix = `${company}/${userId}/`;
  if (
    typeof path !== "string" ||
    !path.startsWith(prefix) ||
    !path.endsWith(".pdf") ||
    !UUID.test(path.slice(prefix.length, -4))
  )
    return { ok: false, msg: "Ese PDF no pertenece a esta carga y empresa." };
  const { data: info, error } = await db().storage.from(BANK_BUCKET).info(path);
  if (
    error ||
    !info ||
    !info.size ||
    info.size > MAX_BANK_PDF ||
    info.contentType !== "application/pdf"
  )
    return {
      ok: false,
      msg: "El PDF no se cargó correctamente o supera 15 MB.",
    };
  const { data: file, error: downloadError } = await db()
    .storage.from(BANK_BUCKET)
    .download(path);
  if (downloadError || !file)
    return { ok: false, msg: "No se pudo abrir el PDF. Vuelve a intentarlo." };
  const bytes = Buffer.from(await file.arrayBuffer());
  if (
    bytes.length > MAX_BANK_PDF ||
    bytes.subarray(0, 5).toString("ascii") !== "%PDF-"
  )
    return { ok: false, msg: "El archivo no es un PDF válido." };
  return { ok: true, bytes };
}
