import "server-only";
import { listLabPurchases } from "./lab-purchases-data";
import { listRequests } from "./store-requests-data";
import { db } from "./supabase";
import {
  isGoods, isItemKind, isTransferStatus, pendingToSend, sentBySource, type PendingRow, type Transfer, type TransferArrival, type TransferFull, type TransferItem,
  type TransferPoint,
} from "./transfers";

// Compras › Traslados: lectura de la base y archivos (bucket privado transfer-files).

// tablas que todavía no existen (migración sin aplicar): la sección se ve vacía en vez de fallar
const missingTable = (e: { code?: string }) => e.code === "42P01" || e.code === "PGRST205";

export const TRANSFER_BUCKET = "transfer-files";

/** Bodegas (activas e inactivas), en su orden. */
export async function listPoints(): Promise<TransferPoint[]> {
  const { data, error } = await db().from("transfer_points").select("*").order("position").order("name");
  if (error) {
    if (missingTable(error)) return [];
    throw error;
  }
  return ((data ?? []) as TransferPoint[]).map((p) => ({
    ...p,
    goods: isGoods(p.goods) ? p.goods : "both",
    accounts: Array.isArray(p.accounts) ? p.accounts : [],
    position: Number(p.position ?? 0),
  }));
}

const toItem = (i: TransferItem): TransferItem => ({
  ...i,
  kind: isItemKind(i.kind) ? i.kind : "import",
  qty: Number(i.qty),
  received_qty: i.received_qty === null || i.received_qty === undefined ? null : Number(i.received_qty),
  damaged_qty: Number(i.damaged_qty ?? 0),
  position: Number(i.position ?? 0),
});

/** Traslados con sus productos y llegadas, del más reciente al más viejo. */
export async function listTransfers(): Promise<TransferFull[]> {
  const [t, items, arrivals] = await Promise.all([
    db().from("transfers").select("*").order("created_at", { ascending: false }).limit(2000),
    db().from("transfer_items").select("*").order("position").limit(50000),
    db().from("transfer_arrivals").select("*").limit(20000),
  ]);
  if (t.error) {
    if (missingTable(t.error)) return [];
    throw t.error;
  }
  if (items.error) throw items.error;
  if (arrivals.error) throw arrivals.error;
  const itemsBy = new Map<string, TransferItem[]>();
  for (const i of (items.data ?? []) as TransferItem[]) itemsBy.set(i.transfer_id, [...(itemsBy.get(i.transfer_id) ?? []), toItem(i)]);
  const arrivalsBy = new Map<string, TransferArrival[]>();
  for (const a of (arrivals.data ?? []) as TransferArrival[]) arrivalsBy.set(a.transfer_id, [...(arrivalsBy.get(a.transfer_id) ?? []), a]);
  return ((t.data ?? []) as Transfer[]).map((r) => ({
    ...r,
    status: isTransferStatus(r.status) ? r.status : "preparing",
    items: itemsBy.get(r.id) ?? [],
    arrivals: arrivalsBy.get(r.id) ?? [],
  }));
}

export type TransferDocument = { id: string; kind: string; filename: string | null; content_type: string; size_bytes: number | null; uploaded_by: string | null; created_at: string };
export type TransferEvent = { id: string; note: string; by_user: string | null; at: string };

/** Un traslado con todo: productos, llegadas, documentos, historial y los nombres de quién hizo cada cosa. */
export async function getTransfer(id: string): Promise<(TransferFull & { documents: TransferDocument[]; events: TransferEvent[]; people: Record<string, string> }) | null> {
  const [t, items, arrivals, docs, events, users] = await Promise.all([
    db().from("transfers").select("*").eq("id", id).maybeSingle(),
    db().from("transfer_items").select("*").eq("transfer_id", id).order("position"),
    db().from("transfer_arrivals").select("*").eq("transfer_id", id),
    db().from("transfer_documents").select("id, kind, filename, content_type, size_bytes, uploaded_by, created_at").eq("transfer_id", id).order("created_at"),
    db().from("transfer_events").select("id, note, by_user, at").eq("transfer_id", id).order("at", { ascending: false }).limit(200),
    db().from("app_users").select("id, name"),
  ]);
  if (t.error) {
    if (missingTable(t.error)) return null;
    throw t.error;
  }
  if (!t.data) return null;
  const r = t.data as Transfer;
  return {
    ...r,
    status: isTransferStatus(r.status) ? r.status : "preparing",
    items: ((items.data ?? []) as TransferItem[]).map(toItem),
    arrivals: (arrivals.data ?? []) as TransferArrival[],
    documents: (docs.data ?? []) as TransferDocument[],
    events: (events.data ?? []) as TransferEvent[],
    people: Object.fromEntries(((users.data ?? []) as { id: string; name: string }[]).map((u) => [u.id, u.name])),
  };
}

/** Tipos de documento de cada traslado (para marcar en la lista cuáles tienen manifiesto). */
export async function documentKinds(): Promise<Map<string, string[]>> {
  const { data, error } = await db().from("transfer_documents").select("transfer_id, kind").limit(20000);
  if (error) {
    if (missingTable(error)) return new Map();
    throw error;
  }
  const out = new Map<string, string[]>();
  for (const d of (data ?? []) as { transfer_id: string; kind: string }[]) out.set(d.transfer_id, [...(out.get(d.transfer_id) ?? []), d.kind]);
  return out;
}

/** Repartos dados por enviar sin traslado. */
export async function listSettled(): Promise<Set<string>> {
  const { data, error } = await db().from("transfer_settled").select("source").limit(20000);
  if (error) {
    if (missingTable(error)) return new Set();
    throw error;
  }
  return new Set(((data ?? []) as { source: string }[]).map((s) => s.source));
}

/** Lo que falta mandar a cada país (repartos de Solicitudes y Laboratorios menos lo enviado). */
export async function listPending(transfers: readonly TransferFull[], points: readonly TransferPoint[]): Promise<PendingRow[]> {
  const [requests, labs, settled] = await Promise.all([
    listRequests().catch((e) => (console.error("traslados: solicitudes", e), [])),
    listLabPurchases().catch((e) => (console.error("traslados: laboratorios", e), [])),
    listSettled(),
  ]);
  return pendingToSend({ requests, labs, points, sent: sentBySource(transfers), settled });
}

// ─── Archivos ───

/** Enlace firmado para subir un documento directo a Storage desde el navegador. */
export async function signedTransferUpload(transferId: string, ext: string): Promise<{ path: string; url: string }> {
  const path = `${transferId}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await db().storage.from(TRANSFER_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw error ?? new Error("Storage no devolvió el enlace de subida");
  return { path, url: data.signedUrl };
}

/** Tipo y tamaño reales del archivo ya subido (de Storage, no del navegador). */
export async function storedTransferFile(path: string): Promise<{ contentType: string; size: number } | null> {
  const { data, error } = await db().storage.from(TRANSFER_BUCKET).info(path);
  if (error || !data) return null;
  return { contentType: String(data.contentType ?? "").toLowerCase(), size: Number(data.size ?? 0) };
}

export async function removeTransferFiles(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await db().storage.from(TRANSFER_BUCKET).remove(paths);
  if (error) throw error;
}

export async function signedTransferRead(path: string, seconds: number, download?: string): Promise<string> {
  const { data, error } = await db().storage.from(TRANSFER_BUCKET).createSignedUrl(path, seconds, download ? { download } : undefined);
  if (error || !data) throw error ?? new Error("Storage no devolvió el enlace");
  return data.signedUrl;
}
