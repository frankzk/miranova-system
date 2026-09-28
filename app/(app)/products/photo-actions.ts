"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth";
import { isMediaKey, mediaKey, mediaProblem, mediaType } from "@/lib/media-rules";
import { deleteMedia, getMedia, registerMedia, signedUpload, updateCaption } from "@/lib/product-media";
import { listProducts } from "@/lib/queries";

// Subir, describir y borrar requieren el permiso Fotos. El archivo no pasa por el servidor: aquí
// se da un enlace firmado para subirlo directo a Storage y luego se registra lo que llegó.

type Result<T = object> = ({ ok: true } & T) | { ok: false; msg: string };

async function knownKey(key: unknown): Promise<boolean> {
  if (!isMediaKey(key)) return false;
  return (await listProducts()).some((p) => mediaKey(p) === key);
}

export async function startUpload(key: string, filename: string, type: string, size: number): Promise<Result<{ path: string; url: string; type: string }>> {
  const auth = await authorizeAction("photos");
  if (!auth.ok) return auth;
  const name = String(filename ?? "").slice(0, 200);
  const problem = mediaProblem(String(type ?? ""), name, Number(size));
  if (problem) return { ok: false, msg: problem };
  if (!(await knownKey(key))) return { ok: false, msg: "Ese producto ya no está en el catálogo." };
  const ct = mediaType(String(type ?? ""), name)!;
  try {
    return { ok: true, type: ct, ...(await signedUpload(key, ct)) };
  } catch {
    return { ok: false, msg: "No se pudo preparar la subida. Inténtalo de nuevo." };
  }
}

export async function finishUpload(key: string, path: string, filename: string): Promise<Result> {
  const auth = await authorizeAction("photos");
  if (!auth.ok) return auth;
  if (!(await knownKey(key))) return { ok: false, msg: "Ese producto ya no está en el catálogo." };
  try {
    await registerMedia({ key, path: String(path ?? ""), filename: String(filename ?? ""), userId: auth.user.id });
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : "No se pudo registrar el archivo." };
  }
  revalidatePath("/products");
  return { ok: true };
}

export async function saveCaption(id: string, caption: string): Promise<Result> {
  const auth = await authorizeAction("photos");
  if (!auth.ok) return auth;
  const item = await getMedia(String(id ?? ""));
  if (!item) return { ok: false, msg: "Ese archivo ya no existe." };
  await updateCaption(item.id, String(caption ?? ""));
  revalidatePath("/products");
  return { ok: true };
}

export async function removeMedia(id: string): Promise<Result> {
  const auth = await authorizeAction("photos");
  if (!auth.ok) return auth;
  const item = await getMedia(String(id ?? ""));
  if (!item) return { ok: false, msg: "Ese archivo ya no existe." };
  try {
    await deleteMedia(item);
  } catch {
    return { ok: false, msg: "No se pudo borrar. Inténtalo de nuevo." };
  }
  revalidatePath("/products");
  return { ok: true };
}
