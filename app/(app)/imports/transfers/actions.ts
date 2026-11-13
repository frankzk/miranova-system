"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authorizeAction } from "@/lib/auth";
import { IMPORT_FILE_TYPES, importFileProblem, importFileType, MAX_IMPORT_FILE_BYTES } from "@/lib/imports";
import { db } from "@/lib/supabase";
import { todayIn } from "@/lib/format";
import {
  cleanArrival, cleanHeader, cleanLine, cleanPoint, dayLabel, isDay, isItemKind, nextTransferCode, pointCode, statusAfterArrivals,
  type TransferArrival, type TransferItem,
} from "@/lib/transfers";
import { getTransfer, listPending, listPoints, listTransfers, removeTransferFiles, signedTransferUpload, storedTransferFile } from "@/lib/transfers-data";

// Compras › Traslados: crear y editar traslados, sus productos, la salida, la llegada a cada bodega, los
// documentos (manifiesto), las bodegas y "Por enviar".

export type TransferFormState = { ok: boolean; msg: string } | null;
type Result<T = object> = ({ ok: true } & T) | { ok: false; msg: string };

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (msg: string): TransferFormState => ({ ok: false, msg });
const GONE = "Ese traslado ya no existe.";
const missingTable = (e: { code?: string }) => e.code === "42P01" || e.code === "PGRST205";
const NO_TABLE = "Falta preparar la base de datos para los traslados. Avísale al administrador.";
const dbError = (prefix: string, e: { code?: string; message: string }) => fail(missingTable(e) ? NO_TABLE : `${prefix}: ${e.message}`);

async function logEvent(transferId: string, by: string | null, note: string) {
  await db().from("transfer_events").insert({ transfer_id: transferId, note, by_user: by, at: new Date().toISOString() });
}

function done(transferId: string, msg: string): TransferFormState {
  revalidatePath("/imports/transfers");
  revalidatePath(`/imports/transfers/${transferId}`);
  return { ok: true, msg };
}

/** El traslado (con productos y llegadas) si el id es válido. */
async function transferOf(id: string) {
  return UUID.test(id) ? getTransfer(id) : null;
}

const pointName = (points: { id: string; name: string }[], id: string) => points.find((p) => p.id === id)?.name ?? "bodega";

// ─── Traslado ───

function headerInput(form: FormData) {
  return {
    origin_id: field(form, "origin_id"), dest_country: field(form, "dest_country"), carrier: field(form, "carrier"), reference: field(form, "reference"),
    shipped_at: field(form, "shipped_at"), eta: field(form, "eta"), notes: field(form, "notes"),
  };
}

/** Código nuevo del año; si dos se crean a la vez, se reintenta. */
async function insertTransfer(row: Record<string, unknown>, by: string): Promise<{ id: string } | { error: TransferFormState }> {
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: codes, error: readErr } = await db().from("transfers").select("code");
    if (readErr) return { error: dbError("No se pudo crear", readErr) };
    const code = nextTransferCode(year, ((codes ?? []) as { code: string }[]).map((c) => c.code));
    const now = new Date().toISOString();
    const { data, error } = await db().from("transfers").insert({ ...row, code, created_by: by, created_at: now, updated_at: now }).select("id").single();
    if (!error && data) return { id: (data as { id: string }).id };
    if (error && !/duplicate|unique/i.test(error.message)) return { error: dbError("No se pudo crear", error) };
  }
  return { error: fail("No se pudo crear el traslado. Inténtalo de nuevo.") };
}

export async function createTransfer(_prev: TransferFormState, form: FormData): Promise<TransferFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const points = await listPoints();
  const h = cleanHeader(headerInput(form), points);
  if (!h.ok) return fail(h.msg);
  // empieza "Preparando": sale con "Marcar como enviado", cuando ya tiene sus productos
  const res = await insertTransfer({ ...h.row, shipped_at: null, status: "preparing" }, auth.user.id);
  if ("error" in res) return res.error;
  await logEvent(res.id, auth.user.id, "Traslado creado");
  revalidatePath("/imports/transfers");
  redirect(`/imports/transfers/${res.id}`);
}

export async function updateTransfer(_prev: TransferFormState, form: FormData): Promise<TransferFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const t = await transferOf(field(form, "id"));
  if (!t) return fail(GONE);
  const points = await listPoints();
  const h = cleanHeader(headerInput(form), points);
  if (!h.ok) return fail(h.msg);
  if (t.items.length && h.row.dest_country !== t.dest_country) return fail("Ya tiene productos para otro país: quítalos antes de cambiar el país.");
  if (t.items.some((i) => i.dest_id === h.row.origin_id)) return fail("Un producto va a la misma bodega de origen: cámbialo antes.");
  // mientras se prepara no tiene salida: se confirma con "Marcar como enviado"
  const row = t.status === "preparing" ? { ...h.row, shipped_at: null } : h.row;
  if (t.status !== "preparing" && !row.shipped_at) return fail("Ya salió: escribe la fecha de salida.");
  const { error } = await db().from("transfers").update({ ...row, updated_at: new Date().toISOString() }).eq("id", t.id);
  if (error) return dbError("No se pudo guardar", error);
  await logEvent(t.id, auth.user.id, "Datos del traslado editados");
  return done(t.id, "Guardado.");
}

/** Sale: fecha de salida y estimada de llegada. Necesita al menos un producto. */
export async function shipTransfer(_prev: TransferFormState, form: FormData): Promise<TransferFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const t = await transferOf(field(form, "id"));
  if (!t) return fail(GONE);
  if (t.status !== "preparing") return fail("Ese traslado ya salió.");
  if (!t.items.length) return fail("Agrega al menos un producto antes de enviarlo.");
  const shipped = field(form, "shipped_at");
  const eta = field(form, "eta") || null;
  if (!isDay(shipped)) return fail("Escribe la fecha de salida.");
  if (shipped > todayIn()) return fail("La fecha de salida no puede ser futura.");
  if (eta && (!isDay(eta) || eta < shipped)) return fail("La llegada estimada no puede ser antes de la salida.");
  const carrier = field(form, "carrier").slice(0, 60) || t.carrier;
  const reference = field(form, "reference").slice(0, 80) || t.reference;
  const { error } = await db().from("transfers").update({ status: "transit", shipped_at: shipped, eta, carrier, reference, updated_at: new Date().toISOString() }).eq("id", t.id);
  if (error) return dbError("No se pudo guardar", error);
  await logEvent(t.id, auth.user.id, `Salió el ${dayLabel(shipped)}${eta ? `; llegada estimada ${dayLabel(eta)}` : ""}`);
  return done(t.id, "Marcado como enviado.");
}

/** Cancelar (no cuenta como enviado) o reabrir un cancelado. */
export async function setTransferCancelled(_prev: TransferFormState, form: FormData): Promise<TransferFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const t = await transferOf(field(form, "id"));
  if (!t) return fail(GONE);
  const cancel = field(form, "cancel") === "1";
  if (cancel && t.status === "arrived") return fail("Ya llegó: no se puede cancelar.");
  const status = cancel ? "cancelled" : t.shipped_at ? statusAfterArrivals({ ...t, status: "transit" }) : "preparing";
  const { error } = await db().from("transfers").update({ status, updated_at: new Date().toISOString() }).eq("id", t.id);
  if (error) return dbError("No se pudo guardar", error);
  await logEvent(t.id, auth.user.id, cancel ? "Traslado cancelado" : "Traslado reabierto");
  return done(t.id, cancel ? "Traslado cancelado." : "Traslado reabierto.");
}

export async function deleteTransfer(_prev: TransferFormState, form: FormData): Promise<TransferFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const t = await transferOf(field(form, "id"));
  if (!t) return fail(GONE);
  if (field(form, "confirm").toUpperCase() !== "ELIMINAR") return fail("Escribe ELIMINAR para confirmar.");
  if (t.arrivals.length) return fail("Ya tiene llegadas registradas: cancélalo en vez de borrarlo.");
  const { data: docs } = await db().from("transfer_documents").select("storage_path").eq("transfer_id", t.id);
  const { error } = await db().from("transfers").delete().eq("id", t.id);
  if (error) return dbError("No se pudo borrar", error);
  await removeTransferFiles(((docs ?? []) as { storage_path: string }[]).map((d) => d.storage_path)).catch(() => {});
  revalidatePath("/imports/transfers");
  redirect("/imports/transfers");
}

// ─── Productos ───

/** ¿Se pueden cambiar los productos de esta bodega? (no después de registrar su llegada, ni cancelado o llegado) */
function editable(t: { status: string; arrivals: TransferArrival[] }, destId: string): string | null {
  if (t.status === "cancelled") return "El traslado está cancelado.";
  if (t.status === "arrived") return "El traslado ya llegó.";
  if (t.arrivals.some((a) => a.dest_id === destId)) return "Esa bodega ya registró la llegada.";
  return null;
}

export async function addTransferLine(_prev: TransferFormState, form: FormData): Promise<TransferFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const t = await transferOf(field(form, "id"));
  if (!t) return fail(GONE);
  const points = await listPoints();
  const accountId = field(form, "account_id");
  const externalId = field(form, "product_id").slice(0, 120);
  let product: { name: string; sku: string | null; image_url: string | null } | null = null;
  if (accountId || externalId) {
    if (!UUID.test(accountId) || !externalId) return fail("Ese producto ya no está en el catálogo.");
    const { data } = await db().from("products").select("name, sku, image_url").eq("account_id", accountId).eq("external_id", externalId).maybeSingle();
    if (!data) return fail("Ese producto ya no está en el catálogo.");
    product = data as { name: string; sku: string | null; image_url: string | null };
  }
  const c = cleanLine(
    { dest_id: field(form, "dest_id"), kind: field(form, "kind"), name: product?.name ?? field(form, "name"), sku: product?.sku ?? field(form, "sku"), qty: field(form, "qty") },
    { points, origin_id: t.origin_id, country: t.dest_country },
  );
  if (!c.ok) return fail(c.msg);
  const blocked = editable(t, c.row.dest_id);
  if (blocked) return fail(blocked);
  const position = t.items.reduce((m, i) => Math.max(m, i.position), -1) + 1;
  const { error } = await db().from("transfer_items").insert({
    transfer_id: t.id, ...c.row, account_id: product ? accountId : null, product_external_id: product ? externalId : null, image_url: product?.image_url ?? null,
    position, created_at: new Date().toISOString(),
  });
  if (error) return dbError("No se pudo agregar", error);
  await logEvent(t.id, auth.user.id, `Producto agregado: ${c.row.name} (${c.row.qty.toLocaleString("en-US")} u. a ${pointName(points, c.row.dest_id)})`);
  return done(t.id, `${c.row.name} agregado.`);
}

export async function updateTransferLine(_prev: TransferFormState, form: FormData): Promise<TransferFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const t = await transferOf(field(form, "id"));
  if (!t) return fail(GONE);
  const line = t.items.find((i) => i.id === field(form, "item_id"));
  if (!line) return fail("Ese producto ya no está en el traslado.");
  const points = await listPoints();
  const c = cleanLine({ dest_id: field(form, "dest_id"), kind: field(form, "kind"), name: line.name, sku: line.sku ?? "", qty: field(form, "qty") }, { points, origin_id: t.origin_id, country: t.dest_country });
  if (!c.ok) return fail(c.msg);
  const blocked = editable(t, line.dest_id) ?? editable(t, c.row.dest_id);
  if (blocked) return fail(blocked);
  const { error } = await db().from("transfer_items").update({ dest_id: c.row.dest_id, kind: c.row.kind, qty: c.row.qty }).eq("id", line.id);
  if (error) return dbError("No se pudo guardar", error);
  await logEvent(t.id, auth.user.id, `Producto editado: ${line.name} (${c.row.qty.toLocaleString("en-US")} u. a ${pointName(points, c.row.dest_id)})`);
  return done(t.id, "Guardado.");
}

export async function removeTransferLine(_prev: TransferFormState, form: FormData): Promise<TransferFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const t = await transferOf(field(form, "id"));
  if (!t) return fail(GONE);
  const line = t.items.find((i) => i.id === field(form, "item_id"));
  if (!line) return fail("Ese producto ya no está en el traslado.");
  const blocked = editable(t, line.dest_id);
  if (blocked) return fail(blocked);
  const { error } = await db().from("transfer_items").delete().eq("id", line.id);
  if (error) return dbError("No se pudo quitar", error);
  await logEvent(t.id, auth.user.id, `Producto quitado: ${line.name}`);
  return done(t.id, "Quitado.");
}

// ─── Llegada a una bodega ───

/** Lo que llegó a una bodega: fecha y, por producto, recibidas, dañadas y nota. Se puede corregir después. */
export async function registerArrival(_prev: TransferFormState, form: FormData): Promise<TransferFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const t = await transferOf(field(form, "id"));
  if (!t) return fail(GONE);
  if (t.status === "preparing") return fail("Primero márcalo como enviado.");
  if (t.status === "cancelled") return fail("El traslado está cancelado.");
  const destId = field(form, "dest_id");
  const items = t.items.filter((i) => i.dest_id === destId);
  if (!items.length) return fail("Esa bodega no tiene productos en este traslado.");
  const arrived = field(form, "arrived_at");
  if (!isDay(arrived)) return fail("Escribe la fecha de llegada.");
  if (arrived > todayIn()) return fail("La fecha de llegada no puede ser futura.");
  if (t.shipped_at && arrived < t.shipped_at) return fail("La llegada no puede ser antes de la salida.");
  const c = cleanArrival(items, Object.fromEntries(items.map((i) => [i.id, { received: field(form, `recv_${i.id}`), damaged: field(form, `dmg_${i.id}`), note: field(form, `note_${i.id}`) }])));
  if (!c.ok) return fail(c.msg);
  for (const r of c.rows) {
    const { error } = await db().from("transfer_items").update({ received_qty: r.received_qty, damaged_qty: r.damaged_qty, received_note: r.received_note }).eq("id", r.id);
    if (error) return dbError("No se pudo guardar", error);
  }
  const arrival: TransferArrival = { transfer_id: t.id, dest_id: destId, arrived_at: arrived, note: field(form, "note").slice(0, 500) || null, received_by: auth.user.id };
  const { error } = await db().from("transfer_arrivals").upsert({ ...arrival, created_at: new Date().toISOString() }, { onConflict: "transfer_id,dest_id" });
  if (error) return dbError("No se pudo guardar", error);
  const arrivals = [...t.arrivals.filter((a) => a.dest_id !== destId), arrival];
  const status = statusAfterArrivals({ ...t, arrivals });
  if (status !== t.status) await db().from("transfers").update({ status, updated_at: new Date().toISOString() }).eq("id", t.id);
  const points = await listPoints();
  const sent = items.reduce((s, i) => s + i.qty, 0);
  const got = c.rows.reduce((s, r) => s + r.received_qty, 0);
  const dmg = c.rows.reduce((s, r) => s + r.damaged_qty, 0);
  const missing = items.reduce((s, i) => s + Math.max(0, i.qty - (c.rows.find((r) => r.id === i.id)?.received_qty ?? 0)), 0);
  await logEvent(t.id, auth.user.id, `Llegó a ${pointName(points, destId)} el ${dayLabel(arrived)}: ${got.toLocaleString("en-US")} de ${sent.toLocaleString("en-US")} u.${missing ? `, merma ${missing.toLocaleString("en-US")}` : ""}${dmg ? `, ${dmg.toLocaleString("en-US")} dañadas` : ""}`);
  return done(t.id, status === "arrived" ? "Llegada guardada. El traslado llegó completo." : "Llegada guardada.");
}

// ─── Documentos (manifiesto, fotos) ───

const DOC_KINDS = ["manifest", "photo", "other"];
const isTransferFilePath = (path: string, transferId: string) =>
  new RegExp(`^${transferId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(pdf|jpg|png|webp|xlsx)$`).test(path);

export async function startTransferUpload(transferId: string, kind: string, filename: string, type: string, size: number): Promise<Result<{ path: string; url: string; type: string }>> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  if (!DOC_KINDS.includes(kind)) return { ok: false, msg: "Tipo de documento no válido." };
  const t = await transferOf(String(transferId ?? ""));
  if (!t) return { ok: false, msg: GONE };
  const name = String(filename ?? "").slice(0, 200);
  const problem = importFileProblem(String(type ?? ""), name, Number(size), kind === "photo");
  if (problem) return { ok: false, msg: problem };
  const ct = importFileType(String(type ?? ""), name)!;
  try {
    return { ok: true, type: ct, ...(await signedTransferUpload(t.id, IMPORT_FILE_TYPES[ct].ext)) };
  } catch {
    return { ok: false, msg: "No se pudo preparar la subida. Inténtalo de nuevo." };
  }
}

/** Registra un documento ya subido; toma tipo y tamaño de Storage. */
export async function registerTransferDocument(transferId: string, path: string, kind: string, filename: string): Promise<Result<{ id: string }>> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  if (!DOC_KINDS.includes(kind)) return { ok: false, msg: "Tipo de documento no válido." };
  const t = await transferOf(String(transferId ?? ""));
  if (!t) return { ok: false, msg: GONE };
  if (!isTransferFilePath(String(path ?? ""), t.id)) return { ok: false, msg: "Ruta de archivo no válida." };
  const info = await storedTransferFile(path);
  if (!info) return { ok: false, msg: "El archivo no llegó a guardarse; vuelve a subirlo." };
  if (!IMPORT_FILE_TYPES[info.contentType] || info.size > MAX_IMPORT_FILE_BYTES) {
    await removeTransferFiles([path]).catch(() => {});
    return { ok: false, msg: "Solo PDF, fotos o Excel de hasta 25 MB." };
  }
  const { data, error } = await db()
    .from("transfer_documents")
    .insert({ transfer_id: t.id, kind, storage_path: path, filename: String(filename ?? "").slice(0, 200) || null, content_type: info.contentType, size_bytes: info.size, uploaded_by: auth.user.id, created_at: new Date().toISOString() })
    .select("id")
    .single();
  if (error || !data) {
    await removeTransferFiles([path]).catch(() => {});
    return { ok: false, msg: missingTable(error ?? {}) ? NO_TABLE : `No se pudo guardar: ${error?.message ?? "sin respuesta"}` };
  }
  await logEvent(t.id, auth.user.id, `${kind === "manifest" ? "Manifiesto" : kind === "photo" ? "Foto" : "Documento"} subido: ${filename}`);
  revalidatePath(`/imports/transfers/${t.id}`);
  revalidatePath("/imports/transfers");
  return { ok: true, id: (data as { id: string }).id };
}

export async function removeTransferDocument(_prev: TransferFormState, form: FormData): Promise<TransferFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const id = field(form, "doc_id");
  if (!UUID.test(id)) return fail("Ese documento ya no existe.");
  const { data } = await db().from("transfer_documents").select("transfer_id, storage_path, filename").eq("id", id).maybeSingle();
  const doc = data as { transfer_id: string; storage_path: string; filename: string | null } | null;
  if (!doc) return fail("Ese documento ya no existe.");
  const { error } = await db().from("transfer_documents").delete().eq("id", id);
  if (error) return dbError("No se pudo quitar", error);
  await removeTransferFiles([doc.storage_path]).catch(() => {});
  await logEvent(doc.transfer_id, auth.user.id, `Documento quitado: ${doc.filename ?? ""}`);
  return done(doc.transfer_id, "Documento quitado.");
}

// ─── Por enviar ───

/**
 * Arma un traslado con lo elegido de "Por enviar" de un país: cada fila con su clave de reparto, bodega y
 * cantidad (no más de lo que falta). Queda "Preparando" con esos productos.
 */
export async function buildTransfer(_prev: TransferFormState, form: FormData): Promise<TransferFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const points = await listPoints();
  const h = cleanHeader({ origin_id: field(form, "origin_id"), dest_country: field(form, "dest_country"), carrier: field(form, "carrier"), notes: "" }, points);
  if (!h.ok) return fail(h.msg);
  const transfers = await listTransfers();
  const pending = (await listPending(transfers, points)).filter((p) => p.country === h.row.dest_country);
  const chosen = form.getAll("source").map(String);
  if (!chosen.length) return fail("Marca al menos un producto.");
  const lines: Omit<TransferItem, "id" | "transfer_id" | "received_qty" | "damaged_qty" | "received_note">[] = [];
  for (const [n, source] of chosen.entries()) {
    const p = pending.find((x) => x.source === source);
    if (!p) return fail("Algo de lo marcado ya no está por enviar. Recarga la página.");
    const kind = field(form, `kind_${source}`) || p.kind;
    const c = cleanLine({ dest_id: field(form, `dest_${source}`) || p.dest_id || "", kind: isItemKind(kind) ? kind : p.kind, name: p.product, qty: field(form, `qty_${source}`) }, {
      points, origin_id: h.row.origin_id, country: h.row.dest_country,
    });
    if (!c.ok) return fail(c.msg);
    if (c.row.qty > p.pending) return fail(`${p.product}: faltan enviar ${p.pending.toLocaleString("en-US")}; no puedes mandar ${c.row.qty.toLocaleString("en-US")}.`);
    lines.push({ ...c.row, account_id: null, product_external_id: null, image_url: null, source, position: n });
  }
  const res = await insertTransfer({ ...h.row, status: "preparing" }, auth.user.id);
  if ("error" in res) return res.error;
  const { error } = await db().from("transfer_items").insert(lines.map((l) => ({ ...l, transfer_id: res.id, created_at: new Date().toISOString() })));
  if (error) {
    await db().from("transfers").delete().eq("id", res.id);
    return dbError("No se pudieron agregar los productos", error);
  }
  await logEvent(res.id, auth.user.id, `Traslado armado desde "Por enviar" con ${lines.length} ${lines.length === 1 ? "producto" : "productos"}`);
  revalidatePath("/imports/transfers");
  redirect(`/imports/transfers/${res.id}`);
}

/** Dar un reparto por enviado sin traslado (se mandó por fuera o ya no se manda): sale de "Por enviar". */
export async function settlePending(_prev: TransferFormState, form: FormData): Promise<TransferFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const source = field(form, "source");
  if (!/^(req|lab):[^\s]{1,300}$/.test(source)) return fail("Ese reparto ya no existe.");
  const { error } = await db().from("transfer_settled").upsert({ source, note: field(form, "note").slice(0, 300) || null, by_user: auth.user.id, at: new Date().toISOString() }, { onConflict: "source" });
  if (error) return dbError("No se pudo guardar", error);
  revalidatePath("/imports/transfers");
  return { ok: true, msg: "Quitado de por enviar." };
}

// ─── Bodegas ───

export async function savePoint(_prev: TransferFormState, form: FormData): Promise<TransferFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const id = field(form, "id");
  if (id && !UUID.test(id)) return fail("Esa bodega ya no existe.");
  const c = cleanPoint({
    name: field(form, "name"), country: field(form, "country"), city: field(form, "city"), goods: field(form, "goods"),
    is_origin: form.get("is_origin") === "1", is_destination: form.get("is_destination") === "1", accounts: form.getAll("accounts").map(String),
    active: form.get("active") !== "0",
  });
  if (!c.ok) return fail(c.msg);
  const points = await listPoints();
  const now = new Date().toISOString();
  if (id) {
    const current = points.find((p) => p.id === id);
    if (!current) return fail("Esa bodega ya no existe.");
    const { error } = await db().from("transfer_points").update({ ...c.row, updated_at: now }).eq("id", id);
    if (error) return dbError("No se pudo guardar", error);
  } else {
    const position = points.reduce((m, p) => Math.max(m, p.position), 0) + 10;
    const code = pointCode(c.row.name, c.row.country, points.map((p) => p.code));
    const { error } = await db().from("transfer_points").insert({ ...c.row, code, position, created_at: now, updated_at: now });
    if (error) return dbError("No se pudo guardar", error);
  }
  revalidatePath("/imports/transfers");
  return { ok: true, msg: id ? "Bodega guardada." : `${c.row.name} agregada.` };
}
