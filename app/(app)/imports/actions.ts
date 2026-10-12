"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ImportFormState } from "@/components/import-forms";
import { authorizeAction, type SessionUser } from "@/lib/auth";
import { countryByCode } from "@/lib/countries";
import {
  importFileProblem, importFileType, IMPORT_FILE_TYPES, isAllocation, isCostKind, isDocKind, isImportFilePath, isImportStatus,
  allocationLabel, docKindLabel, isActive, MAX_IMPORT_FILE_BYTES, MONEY_DOCS, nextCode, PAYMENT_METHODS, receptionSummary, statusInfo, TRANSPORTS,
  type EventKind,
} from "@/lib/imports";
import { IMPORT_BUCKET, productChoices, removeFiles, signedUpload, storedFile } from "@/lib/imports-data";
import { refreshTracking } from "@/lib/imports-tracking";
import { integrationKey } from "@/lib/integrations";
import { chargeAllocation, withMatches, wholeQty, type Proposal } from "@/lib/invoice";
import { readInvoice } from "@/lib/invoice-ai";
import { can } from "@/lib/permissions";
import { db } from "@/lib/supabase";

// Importaciones: permiso Importaciones; costos, pagos, precios y documentos con montos (factura,
// comprobante), además permiso Dinero. Montos en USD.

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const fail = (msg: string): ImportFormState => ({ ok: false, msg });
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (u: SessionUser) => can(u, "money");

function done(importId: string, msg: string): ImportFormState {
  revalidatePath(`/imports/${importId}`);
  revalidatePath("/imports");
  return { ok: true, msg };
}

/** Número del formulario: vacío → null; inválido → NaN. */
function amount(f: FormData, k: string): number | null {
  const raw = field(f, k).replace(/[$,\s]/g, "");
  if (!raw) return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : Number.NaN;
}

function day(f: FormData, k: string): string | null | false {
  const v = field(f, k);
  if (!v) return null;
  return DAY.test(v) && !Number.isNaN(Date.parse(v)) ? v : false;
}

async function importOf(id: string): Promise<{ id: string; status: string; arrived_at: string | null } | null> {
  if (!UUID.test(id)) return null;
  const { data } = await db().from("imports").select("id, status, arrived_at").eq("id", id).maybeSingle();
  return (data as { id: string; status: string; arrived_at: string | null } | null) ?? null;
}

/** Historial: `kind` activity/money registra lo que se agrega o quita (no cuenta como novedad del envío; money solo lo ve Dinero). */
async function logEvent(importId: string, userId: string, status: string | null, note: string | null, kind: EventKind = "status") {
  await db().from("import_events").insert({ import_id: importId, status, note, by_user: userId, at: new Date().toISOString(), kind });
  await db().from("imports").update({ updated_at: new Date().toISOString() }).eq("id", importId);
}

/** Datos generales comunes a crear y editar. */
async function headerFields(form: FormData): Promise<{ ok: true; row: Record<string, unknown> } | { ok: false; msg: string }> {
  const dest = field(form, "dest_country");
  if (!countryByCode(dest)) return { ok: false, msg: "Elige el país al que llega." };
  const transport = field(form, "transport") || "courier";
  if (!TRANSPORTS.some((t) => t.id === transport)) return { ok: false, msg: "Elige el tipo de transporte." };
  const ordered = day(form, "ordered_at");
  const eta = day(form, "eta");
  if (ordered === false || eta === false) return { ok: false, msg: "Revisa las fechas." };
  const trackingUrl = field(form, "tracking_url");
  if (trackingUrl && !/^https?:\/\/\S+$/i.test(trackingUrl)) return { ok: false, msg: "El enlace de seguimiento debe empezar con https://" };
  const weight = amount(form, "weight_kg");
  if (Number.isNaN(weight) || (weight !== null && weight < 0)) return { ok: false, msg: "El peso no es válido." };
  // proveedor guardado: la importación guarda su id y su nombre
  const supplierId = field(form, "supplier_id");
  let supplier: { id: string; name: string } | null = null;
  if (supplierId) {
    if (!UUID.test(supplierId)) return { ok: false, msg: "Elige un proveedor de la lista." };
    const { data } = await db().from("import_suppliers").select("id, name").eq("id", supplierId).maybeSingle();
    if (!data) return { ok: false, msg: "Ese proveedor ya no existe; elige otro." };
    supplier = data as { id: string; name: string };
  }
  return {
    ok: true,
    row: {
      supplier_id: supplier?.id ?? null,
      supplier: supplier?.name ?? null,
      order_ref: field(form, "order_ref").replace(/\s+/g, " ").slice(0, 60) || null,
      origin: field(form, "origin").slice(0, 80) || null,
      dest_country: dest,
      ordered_at: ordered,
      eta,
      transport,
      carrier: field(form, "carrier").slice(0, 60) || null,
      tracking_number: field(form, "tracking_number").slice(0, 80) || null,
      tracking_url: trackingUrl.slice(0, 500) || null,
      weight_kg: weight,
      notes: field(form, "notes").slice(0, 2000) || null,
    },
  };
}

export async function createImport(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const h = await headerFields(form);
  if (!h.ok) return fail(h.msg);
  const year = new Date().getFullYear();
  let id: string | null = null;
  // el código se calcula con los del año; si dos se crean a la vez, se reintenta
  for (let attempt = 0; attempt < 3 && !id; attempt++) {
    const { data: codes } = await db().from("imports").select("code");
    const code = nextCode(year, ((codes ?? []) as { code: string }[]).map((c) => c.code));
    const { data, error } = await db()
      .from("imports")
      .insert({ ...h.row, code, status: "quote", created_by: auth.user.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .select("id")
      .single();
    if (!error && data) id = (data as { id: string }).id;
    else if (error && !/duplicate|unique/i.test(error.message)) return fail(`No se pudo crear: ${error.message}`);
  }
  if (!id) return fail("No se pudo crear la importación. Inténtalo de nuevo.");
  await logEvent(id, auth.user.id, "quote", "Importación creada");
  revalidatePath("/imports");
  redirect(`/imports/${id}`);
}

export async function updateImport(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const imp = await importOf(field(form, "id"));
  if (!imp) return fail("Esa importación ya no existe.");
  const h = await headerFields(form);
  if (!h.ok) return fail(h.msg);
  const arrived = day(form, "arrived_at");
  if (arrived === false) return fail("Revisa la fecha de llegada.");
  const { error } = await db().from("imports").update({ ...h.row, arrived_at: arrived, updated_at: new Date().toISOString() }).eq("id", imp.id);
  if (error) return fail(`No se pudo guardar: ${error.message}`);
  await logEvent(imp.id, auth.user.id, null, "Datos de la importación editados", "activity");
  return done(imp.id, "Guardado.");
}

export async function setImportStatus(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const imp = await importOf(field(form, "id"));
  if (!imp) return fail("Esa importación ya no existe.");
  const status = field(form, "status");
  if (!isImportStatus(status)) return fail("Elige un estado.");
  const note = field(form, "note").slice(0, 500) || null;
  const changed = status !== imp.status;
  if (!changed && !note) return fail("Ya está en ese estado.");
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  // al recibirla se anota el día, si no se había puesto
  if ((status === "received" || status === "in_drop") && !imp.arrived_at) patch.arrived_at = new Date().toISOString().slice(0, 10);
  const { error } = await db().from("imports").update(patch).eq("id", imp.id);
  if (error) return fail(`No se pudo guardar: ${error.message}`);
  await logEvent(imp.id, auth.user.id, changed ? status : null, note);
  return done(imp.id, changed ? `Estado: ${statusInfo(status).label}.` : "Nota guardada.");
}

export async function setReported(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const imp = await importOf(field(form, "id"));
  if (!imp) return fail("Esa importación ya no existe.");
  const on = field(form, "reported") === "1";
  const { error } = await db()
    .from("imports")
    .update({ reported_at: on ? new Date().toISOString() : null, reported_by: on ? auth.user.id : null, updated_at: new Date().toISOString() })
    .eq("id", imp.id);
  if (error) return fail(`No se pudo guardar: ${error.message}`);
  await logEvent(imp.id, auth.user.id, null, on ? "Reportada a la bodega" : "Se quitó la marca de reportada");
  return done(imp.id, on ? "Marcada como reportada a la bodega." : "Se quitó la marca.");
}

// ─── Productos ───

/** Costo, peso y precio de venta de una línea (costo y precio, solo con permiso Dinero). */
function itemNumbers(form: FormData, withMoney: boolean): { ok: true; row: Record<string, unknown> } | { ok: false; msg: string } {
  const qty = Number(field(form, "qty"));
  if (!Number.isInteger(qty) || qty <= 0 || qty > 10_000_000) return { ok: false, msg: "La cantidad debe ser un número entero mayor que 0." };
  const weight = amount(form, "unit_weight_kg");
  if (Number.isNaN(weight) || (weight !== null && weight < 0)) return { ok: false, msg: "El peso por unidad no es válido." };
  const row: Record<string, unknown> = { qty, unit_weight_kg: weight };
  if (withMoney) {
    const cost = amount(form, "unit_cost");
    if (Number.isNaN(cost) || (cost !== null && cost < 0)) return { ok: false, msg: "El costo por unidad no es válido." };
    const sale = amount(form, "sale_price_usd");
    if (Number.isNaN(sale) || (sale !== null && sale < 0)) return { ok: false, msg: "El precio de venta no es válido." };
    row.unit_cost = cost ?? 0;
    row.sale_price_usd = sale;
  }
  return { ok: true, row };
}

export async function addImportItem(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const imp = await importOf(field(form, "id"));
  if (!imp) return fail("Esa importación ya no existe.");
  const nums = itemNumbers(form, money(auth.user));
  if (!nums.ok) return fail(nums.msg);

  let product: Record<string, unknown>;
  if (field(form, "source") === "catalog") {
    const accountId = field(form, "account_id");
    const externalId = field(form, "product_id");
    if (!UUID.test(accountId) || !externalId) return fail("Elige un producto del catálogo.");
    const { data } = await db().from("products").select("name, sku, image_url").eq("account_id", accountId).eq("external_id", externalId).maybeSingle();
    if (!data) return fail("Ese producto ya no está en el catálogo.");
    const p = data as { name: string; sku: string | null; image_url: string | null };
    product = { account_id: accountId, product_external_id: externalId, name: p.name, sku: p.sku, image_url: p.image_url };
  } else {
    const name = field(form, "name").slice(0, 200);
    if (!name) return fail("Escribe el nombre del producto nuevo.");
    const photo = field(form, "photo_path");
    if (photo) {
      if (!isImportFilePath(photo, imp.id, "items")) return fail("La foto no es válida; vuelve a subirla.");
      const info = await storedFile(photo);
      if (!info || !IMPORT_FILE_TYPES[info.contentType]?.photo || info.size > MAX_IMPORT_FILE_BYTES) {
        await removeFiles([photo]).catch(() => {});
        return fail("La foto no llegó bien; vuelve a subirla (JPG, PNG o WEBP).");
      }
    }
    product = { name, sku: field(form, "sku").slice(0, 80) || null, photo_path: photo || null };
  }

  const { data: last } = await db().from("import_items").select("position").eq("import_id", imp.id).order("position", { ascending: false }).limit(1);
  const position = (((last ?? []) as { position: number }[])[0]?.position ?? -1) + 1;
  const { error } = await db().from("import_items").insert({ import_id: imp.id, ...product, ...nums.row, position, created_at: new Date().toISOString() });
  if (error) return fail(`No se pudo agregar: ${error.message}`);
  await logEvent(imp.id, auth.user.id, null, `Producto agregado: ${String(product.name)} (${Number(nums.row.qty).toLocaleString("en-US")} u.)`, "activity");
  return done(imp.id, `Agregado: ${String(product.name)}. Puedes agregar otro o cerrar.`);
}

/**
 * Recepción en la bodega: cuántas llegaron y cuántas dañadas de cada producto (campos
 * recv_<id>, dmg_<id>, note_<id>). Vacío = todavía sin contar. Al registrarla, la importación
 * pasa a "Recibido" si seguía en camino.
 */
export async function saveReception(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const imp = await importOf(field(form, "id"));
  if (!imp) return fail("Esa importación ya no existe.");
  const { data, error } = await db().from("import_items").select("id, name, qty").eq("import_id", imp.id);
  if (error) return fail(`No se pudo leer: ${error.message}`);
  const lines = (data ?? []) as { id: string; name: string; qty: number }[];
  if (!lines.length) return fail("Primero agrega los productos de la importación.");
  const now = new Date().toISOString();
  const rows: { id: string; received_qty: number | null; damaged_qty: number; received_note: string | null }[] = [];
  for (const l of lines) {
    const recv = amount(form, `recv_${l.id}`);
    const dmg = amount(form, `dmg_${l.id}`) ?? 0;
    const bad = (v: number | null) => v !== null && (Number.isNaN(v) || v < 0 || !Number.isInteger(v) || v > 1_000_000);
    if (bad(recv) || bad(dmg)) return fail(`${l.name}: escribe cantidades enteras, sin decimales.`);
    if (recv === null && dmg > 0) return fail(`${l.name}: anota cuántas llegaron antes de las dañadas.`);
    if (recv !== null && dmg > recv) return fail(`${l.name}: no pueden ser más dañadas (${dmg}) que recibidas (${recv}).`);
    rows.push({ id: l.id, received_qty: recv, damaged_qty: recv === null ? 0 : dmg, received_note: field(form, `note_${l.id}`).slice(0, 300) || null });
  }
  if (rows.every((r) => r.received_qty === null)) return fail("Anota cuántas llegaron de al menos un producto.");
  for (const r of rows) {
    const { error: e } = await db()
      .from("import_items")
      .update({ received_qty: r.received_qty, damaged_qty: r.damaged_qty, received_note: r.received_note, received_at: r.received_qty === null ? null : now, received_by: r.received_qty === null ? null : auth.user.id })
      .eq("id", r.id);
    if (e) return fail(`No se pudo guardar: ${e.message}`);
  }
  const sum = receptionSummary(lines.map((l) => ({ qty: Number(l.qty), ...rows.find((r) => r.id === l.id)! })));
  const parts = [
    `${sum.received.toLocaleString("en-US")} de ${sum.ordered.toLocaleString("en-US")} u.`,
    sum.missing ? `faltan ${sum.missing}` : "",
    sum.extra ? `sobran ${sum.extra}` : "",
    sum.damaged ? `${sum.damaged} dañadas` : "",
    sum.complete ? "" : `${lines.length - sum.lines} sin contar`,
  ].filter(Boolean);
  // al contarla, ya llegó a la bodega
  const arrive = isActive(imp.status) && imp.status !== "quote";
  if (arrive) await db().from("imports").update({ status: "received", arrived_at: imp.arrived_at ?? now.slice(0, 10), updated_at: now }).eq("id", imp.id);
  await logEvent(imp.id, auth.user.id, arrive ? "received" : null, `Recepción: ${parts.join(" · ")}`);
  return done(imp.id, sum.missing || sum.damaged ? "Recepción guardada: el costo por unidad ya se calcula con las unidades buenas." : "Recepción guardada.");
}

/** Enlaza una línea nueva con un producto de Drop del país (para seguir su llegada e Inventario). */
export async function linkImportItem(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const item = await itemOf(field(form, "item_id"));
  if (!item) return fail("Ese producto ya no está en la importación.");
  const accountId = field(form, "account_id");
  const externalId = field(form, "product_id");
  if (!UUID.test(accountId) || !externalId) return fail("Elige el producto de Drop.");
  const [{ data: imp }, { data: acc }, { data: prod }] = await Promise.all([
    db().from("imports").select("dest_country").eq("id", item.import_id).maybeSingle(),
    db().from("accounts").select("country").eq("id", accountId).maybeSingle(),
    db().from("products").select("name, image_url").eq("account_id", accountId).eq("external_id", externalId).maybeSingle(),
  ]);
  if (!prod) return fail("Ese producto ya no está en Drop.");
  if (!imp || !acc || (acc as { country: string }).country !== (imp as { dest_country: string }).dest_country) return fail("El producto debe ser del país al que llega la importación.");
  const p = prod as { name: string; image_url: string | null };
  const { error } = await db()
    .from("import_items")
    .update({ account_id: accountId, product_external_id: externalId, ...(item.photo_path ? {} : { image_url: p.image_url }) })
    .eq("id", item.id);
  if (error) return fail(`No se pudo enlazar: ${error.message}`);
  await logEvent(item.import_id, auth.user.id, null, `${item.name}: enlazado con el producto de Drop "${p.name}"`, "activity");
  return done(item.import_id, `Enlazado con "${p.name}".`);
}

async function itemOf(id: string): Promise<{ id: string; import_id: string; photo_path: string | null; name: string } | null> {
  if (!UUID.test(id)) return null;
  const { data } = await db().from("import_items").select("id, import_id, photo_path, name").eq("id", id).maybeSingle();
  return (data as { id: string; import_id: string; photo_path: string | null; name: string } | null) ?? null;
}

export async function updateImportItem(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const item = await itemOf(field(form, "item_id"));
  if (!item) return fail("Ese producto ya no está en la importación.");
  const nums = itemNumbers(form, money(auth.user));
  if (!nums.ok) return fail(nums.msg);
  const { error } = await db().from("import_items").update(nums.row).eq("id", item.id);
  if (error) return fail(`No se pudo guardar: ${error.message}`);
  await logEvent(item.import_id, auth.user.id, null, `Producto editado: ${item.name} (${Number(nums.row.qty).toLocaleString("en-US")} u.)`, "activity");
  return done(item.import_id, "Guardado.");
}

export async function removeImportItem(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const item = await itemOf(field(form, "item_id"));
  if (!item) return fail("Ese producto ya no está en la importación.");
  const { error } = await db().from("import_items").delete().eq("id", item.id);
  if (error) return fail(`No se pudo quitar: ${error.message}`);
  if (item.photo_path) await removeFiles([item.photo_path]).catch(() => {});
  await logEvent(item.import_id, auth.user.id, null, `Producto quitado: ${item.name}`, "activity");
  return done(item.import_id, `Quitado: ${item.name}.`);
}

// ─── Costos y pagos (permiso Dinero) ───

export async function addImportCost(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  if (!money(auth.user)) return fail("Los costos requieren el permiso de Dinero.");
  const imp = await importOf(field(form, "id"));
  if (!imp) return fail("Esa importación ya no existe.");
  const kind = field(form, "kind");
  const allocation = field(form, "allocation") || "value";
  if (!isCostKind(kind)) return fail("Elige el tipo de costo.");
  if (!isAllocation(allocation)) return fail("Elige cómo repartirlo.");
  const value = amount(form, "amount");
  if (value === null || Number.isNaN(value) || value <= 0) return fail("Escribe el monto en USD, mayor que 0.");
  const label = field(form, "label").slice(0, 120);
  if (!label) return fail("Ponle un nombre al costo (por ejemplo, Flete DHL).");
  let itemId: string | null = null;
  if (allocation === "item") {
    const item = await itemOf(field(form, "item_id"));
    if (!item || item.import_id !== imp.id) return fail("Elige a qué producto va este costo.");
    itemId = item.id;
  }
  const { error } = await db().from("import_costs").insert({ import_id: imp.id, kind, label, amount: value, allocation, item_id: itemId, created_at: new Date().toISOString() });
  if (error) return fail(`No se pudo guardar: ${error.message}`);
  await logEvent(imp.id, auth.user.id, null, `Costo agregado: ${label} · ${usd(value)} · ${allocationLabel(allocation).toLowerCase()}`, "money");
  return done(imp.id, `Costo agregado: ${label}.`);
}

export async function removeImportCost(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  if (!money(auth.user)) return fail("Los costos requieren el permiso de Dinero.");
  const id = field(form, "cost_id");
  if (!UUID.test(id)) return fail("Ese costo ya no existe.");
  const { data } = await db().from("import_costs").select("import_id, label, amount").eq("id", id).maybeSingle();
  if (!data) return fail("Ese costo ya no existe.");
  const cost = data as { import_id: string; label: string; amount: number };
  const { error } = await db().from("import_costs").delete().eq("id", id);
  if (error) return fail(`No se pudo quitar: ${error.message}`);
  await logEvent(cost.import_id, auth.user.id, null, `Costo quitado: ${cost.label} · ${usd(Number(cost.amount))}`, "money");
  return done(cost.import_id, "Costo quitado.");
}

export async function addImportPayment(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  if (!money(auth.user)) return fail("Los pagos requieren el permiso de Dinero.");
  const imp = await importOf(field(form, "id"));
  if (!imp) return fail("Esa importación ya no existe.");
  const value = amount(form, "amount");
  if (value === null || Number.isNaN(value) || value <= 0) return fail("Escribe el monto pagado en USD.");
  const paidAt = day(form, "paid_at");
  if (!paidAt) return fail("Elige la fecha del pago.");
  const method = field(form, "method");
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) return fail("Elige el método de pago.");
  const docId = field(form, "document_id");
  if (docId) {
    const { data } = await db().from("import_documents").select("import_id").eq("id", docId).maybeSingle();
    if (!data || (data as { import_id: string }).import_id !== imp.id) return fail("El comprobante no es de esta importación.");
  }
  const { error } = await db().from("import_payments").insert({
    import_id: imp.id, paid_at: paidAt, amount: value, method, note: field(form, "note").slice(0, 300) || null,
    document_id: docId || null, created_by: auth.user.id, created_at: new Date().toISOString(),
  });
  if (error) return fail(`No se pudo guardar: ${error.message}`);
  await logEvent(imp.id, auth.user.id, null, `Pago registrado: ${usd(value)} · ${method}${docId ? " · con comprobante" : ""}`, "money");
  return done(imp.id, `Pago de ${usd(value)} registrado.`);
}

export async function removeImportPayment(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  if (!money(auth.user)) return fail("Los pagos requieren el permiso de Dinero.");
  const id = field(form, "payment_id");
  if (!UUID.test(id)) return fail("Ese pago ya no existe.");
  const { data } = await db().from("import_payments").select("import_id, amount, method").eq("id", id).maybeSingle();
  if (!data) return fail("Ese pago ya no existe.");
  const pay = data as { import_id: string; amount: number; method: string };
  const { error } = await db().from("import_payments").delete().eq("id", id);
  if (error) return fail(`No se pudo quitar: ${error.message}`);
  await logEvent(pay.import_id, auth.user.id, null, `Pago quitado: ${usd(Number(pay.amount))} · ${pay.method}`, "money");
  return done(pay.import_id, "Pago quitado.");
}

// ─── Archivos ───

type Result<T = object> = ({ ok: true } & T) | { ok: false; msg: string };

/** Enlace firmado para subir un documento (`docs`) o la foto de un producto nuevo (`items`). */
export async function startImportUpload(importId: string, folder: "docs" | "items", kind: string, filename: string, type: string, size: number): Promise<Result<{ path: string; url: string; type: string }>> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  if (folder !== "docs" && folder !== "items") return { ok: false, msg: "Destino no válido." };
  if (folder === "docs" && (!isDocKind(kind) || (MONEY_DOCS.includes(kind) && !money(auth.user)))) return { ok: false, msg: "No puedes subir ese tipo de documento." };
  const imp = await importOf(importId);
  if (!imp) return { ok: false, msg: "Esa importación ya no existe." };
  const name = String(filename ?? "").slice(0, 200);
  const problem = importFileProblem(String(type ?? ""), name, Number(size), folder === "items");
  if (problem) return { ok: false, msg: problem };
  const ct = importFileType(String(type ?? ""), name)!;
  try {
    return { ok: true, type: ct, ...(await signedUpload(imp.id, folder, ct)) };
  } catch {
    return { ok: false, msg: "No se pudo preparar la subida. Inténtalo de nuevo." };
  }
}

/** Registra un documento ya subido; toma tipo y tamaño de Storage. */
/** `forPayment`: el comprobante que se adjunta al registrar un pago ya queda en el historial con el pago. */
export async function registerImportDocument(importId: string, path: string, kind: string, filename: string, forPayment = false): Promise<Result<{ id: string }>> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  if (!isDocKind(kind) || (MONEY_DOCS.includes(kind) && !money(auth.user))) return { ok: false, msg: "No puedes subir ese tipo de documento." };
  const imp = await importOf(importId);
  if (!imp) return { ok: false, msg: "Esa importación ya no existe." };
  if (!isImportFilePath(String(path ?? ""), imp.id, "docs")) return { ok: false, msg: "Ruta de archivo no válida." };
  const info = await storedFile(path);
  if (!info) return { ok: false, msg: "El archivo no llegó a guardarse; vuelve a subirlo." };
  if (!IMPORT_FILE_TYPES[info.contentType] || info.size > MAX_IMPORT_FILE_BYTES) {
    await removeFiles([path]).catch(() => {});
    return { ok: false, msg: "Tipo o tamaño de archivo no permitido." };
  }
  const { data, error } = await db()
    .from("import_documents")
    .insert({
      import_id: imp.id, kind, storage_path: path, filename: String(filename ?? "").slice(0, 200) || null,
      content_type: info.contentType, size_bytes: info.size || null, uploaded_by: auth.user.id, created_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, msg: `No se pudo registrar: ${error?.message ?? "sin respuesta"}` };
  if (!forPayment) {
    await logEvent(imp.id, auth.user.id, null, `Documento subido: ${String(filename ?? "").slice(0, 120) || "archivo"} (${docKindLabel(kind)})`, MONEY_DOCS.includes(kind) ? "money" : "activity");
  }
  revalidatePath(`/imports/${imp.id}`);
  return { ok: true, id: (data as { id: string }).id };
}

export async function removeImportDocument(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const id = field(form, "doc_id");
  if (!UUID.test(id)) return fail("Ese documento ya no existe.");
  const { data } = await db().from("import_documents").select("import_id, kind, storage_path, filename").eq("id", id).maybeSingle();
  if (!data) return fail("Ese documento ya no existe.");
  const doc = data as { import_id: string; kind: string; storage_path: string; filename: string | null };
  if (MONEY_DOCS.includes(doc.kind as never) && !money(auth.user)) return fail("Ese documento requiere el permiso de Dinero.");
  const { error } = await db().from("import_documents").delete().eq("id", id);
  if (error) return fail(`No se pudo borrar: ${error.message}`);
  await removeFiles([doc.storage_path]).catch(() => {});
  await logEvent(doc.import_id, auth.user.id, null, `Documento borrado: ${doc.filename ?? "archivo"} (${docKindLabel(doc.kind)})`, MONEY_DOCS.includes(doc.kind as never) ? "money" : "activity");
  return done(doc.import_id, "Documento borrado.");
}

/** Borra la importación con todo (productos, costos, pagos, documentos y archivos). */
export async function deleteImport(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const imp = await importOf(field(form, "id"));
  if (!imp) return fail("Esa importación ya no existe.");
  if (field(form, "confirm").toUpperCase() !== "ELIMINAR") return fail("Escribe ELIMINAR para confirmar.");
  const [{ data: docs }, { data: its }, { data: costs }, { data: pays }] = await Promise.all([
    db().from("import_documents").select("storage_path, kind").eq("import_id", imp.id),
    db().from("import_items").select("photo_path").eq("import_id", imp.id),
    db().from("import_costs").select("id").eq("import_id", imp.id).limit(1),
    db().from("import_payments").select("id").eq("import_id", imp.id).limit(1),
  ]);
  // quien no tiene Dinero no puede borrar costos, pagos ni facturas que no ve
  const moneyData = (costs ?? []).length > 0 || (pays ?? []).length > 0 || ((docs ?? []) as { kind: string }[]).some((d) => MONEY_DOCS.includes(d.kind as never));
  if (moneyData && !money(auth.user)) return fail("Tiene costos, pagos o facturas: solo alguien con el permiso de Dinero puede eliminarla.");
  const paths = [
    ...((docs ?? []) as { storage_path: string }[]).map((d) => d.storage_path),
    ...((its ?? []) as { photo_path: string | null }[]).map((i) => i.photo_path).filter((p): p is string => Boolean(p)),
  ];
  const { error } = await db().from("imports").delete().eq("id", imp.id);
  if (error) return fail(`No se pudo borrar: ${error.message}`);
  await removeFiles(paths).catch(() => {});
  revalidatePath("/imports");
  redirect("/imports");
}

/** "Actualizar ahora": pregunta por la guía de esta importación (a DHL directo si es DHL, si no a 17TRACK). */
export async function refreshImportTracking(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const imp = await importOf(field(form, "id"));
  if (!imp) return fail("Esa importación ya no existe.");
  const r = await refreshTracking({ ids: [imp.id], force: true });
  if (!r.ok) return fail(r.error);
  if (!r.checked) return fail("Esta importación no tiene guía o todavía no está en camino.");
  return done(imp.id, r.updated ? "Seguimiento actualizado: hay novedades." : "Seguimiento actualizado: sin novedades nuevas.");
}

// ─── Leer una factura con IA ───

const AI_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const AI_MAX_BYTES = 20 * 1024 * 1024;

/** Lee un documento (factura, proforma o packing list) con IA y devuelve la propuesta: no guarda nada. */
export async function readInvoiceDocument(docId: string): Promise<{ ok: true; proposal: Proposal; model: string; existing: number; country: string } | { ok: false; msg: string }> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  if (!UUID.test(String(docId))) return { ok: false, msg: "Ese documento ya no existe." };
  const { data } = await db().from("import_documents").select("import_id, kind, storage_path, content_type, size_bytes").eq("id", docId).maybeSingle();
  if (!data) return { ok: false, msg: "Ese documento ya no existe." };
  const doc = data as { import_id: string; kind: string; storage_path: string; content_type: string; size_bytes: number | null };
  if (MONEY_DOCS.includes(doc.kind as never) && !money(auth.user)) return { ok: false, msg: "Ese documento requiere el permiso de Dinero." };
  if (!AI_TYPES.includes(doc.content_type)) return { ok: false, msg: "La IA lee PDF y fotos (JPG, PNG o WEBP)." };
  if ((doc.size_bytes ?? 0) > AI_MAX_BYTES) return { ok: false, msg: "El archivo pesa más de 20 MB: la IA no lo puede leer." };
  const key = await integrationKey("anthropic");
  if (!key) return { ok: false, msg: "Falta la clave de Anthropic: el dueño la agrega en Ajustes → Integraciones." };
  const { data: blob, error } = await db().storage.from(IMPORT_BUCKET).download(doc.storage_path);
  if (error || !blob) return { ok: false, msg: "No se pudo abrir el archivo. Inténtalo de nuevo." };
  const read = await readInvoice(new Uint8Array(await blob.arrayBuffer()), doc.content_type, key);
  if (!read.ok) return read;
  const [{ data: imp }, { data: its }] = await Promise.all([
    db().from("imports").select("dest_country").eq("id", doc.import_id).maybeSingle(),
    db().from("import_items").select("id").eq("import_id", doc.import_id),
  ]);
  const country = (imp as { dest_country: string } | null)?.dest_country ?? "";
  const proposal = withMatches(read.data, country ? await productChoices(country) : []);
  // sin permiso de Dinero, la propuesta va sin precios ni cargos
  if (!money(auth.user)) {
    proposal.lines = proposal.lines.map((l) => ({ ...l, unit_price: null, line_total: null }));
    proposal.charges = [];
    proposal.total = null;
  }
  return { ok: true, proposal, model: read.model, existing: (its ?? []).length, country };
}

type InvoicePayload = {
  lines: { name: string; sku: string | null; qty: number; unit_cost: number | null; account_id: string | null; external_id: string | null }[];
  charges: { label: string; kind: "shipping" | "import" | "other"; amount: number }[];
  source: string;
};

/** Agrega las líneas y cargos elegidos de la factura leída (campo payload, JSON). */
export async function addInvoiceLines(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const imp = await importOf(field(form, "id"));
  if (!imp) return fail("Esa importación ya no existe.");
  let p: InvoicePayload;
  try {
    p = JSON.parse(field(form, "payload")) as InvoicePayload;
  } catch {
    return fail("No se pudo leer la propuesta. Vuelve a leer la factura.");
  }
  const canMoney = money(auth.user);
  const lines = (Array.isArray(p?.lines) ? p.lines : []).slice(0, 200);
  const charges = canMoney ? (Array.isArray(p?.charges) ? p.charges : []).slice(0, 20) : [];
  if (!lines.length && !charges.length) return fail("Elige al menos un producto o un costo.");
  const { data: impRow } = await db().from("imports").select("dest_country").eq("id", imp.id).maybeSingle();
  const country = (impRow as { dest_country: string } | null)?.dest_country;
  const { data: accs } = await db().from("accounts").select("id, country");
  const okAccounts = new Set(((accs ?? []) as { id: string; country: string }[]).filter((a) => a.country === country).map((a) => a.id));
  const { data: last } = await db().from("import_items").select("position").eq("import_id", imp.id).order("position", { ascending: false }).limit(1);
  let position = (((last ?? []) as { position: number }[])[0]?.position ?? -1) + 1;
  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  for (const l of lines) {
    const name = String(l?.name ?? "").trim().slice(0, 200);
    const qty = wholeQty(Number(l?.qty));
    if (!name || !(qty > 0) || qty > 1_000_000) return fail(`Revisa la cantidad de "${name || "un producto"}".`);
    const cost = canMoney && l.unit_cost !== null && l.unit_cost !== undefined ? Number(l.unit_cost) : 0;
    if (!Number.isFinite(cost) || cost < 0) return fail(`Revisa el precio de "${name}".`);
    let product: Record<string, unknown> = { name, sku: String(l?.sku ?? "").trim().slice(0, 80) || null };
    if (l.account_id && l.external_id && okAccounts.has(l.account_id)) {
      const { data: prod } = await db().from("products").select("name, sku, image_url").eq("account_id", l.account_id).eq("external_id", l.external_id).maybeSingle();
      if (prod) {
        const pr = prod as { name: string; sku: string | null; image_url: string | null };
        product = { account_id: l.account_id, product_external_id: l.external_id, name: pr.name, sku: pr.sku, image_url: pr.image_url };
      }
    }
    rows.push({ import_id: imp.id, ...product, qty, unit_cost: Math.round(cost * 10_000) / 10_000, position: position++, created_at: now });
  }
  if (rows.length) {
    const { error } = await db().from("import_items").insert(rows);
    if (error) return fail(`No se pudieron agregar los productos: ${error.message}`);
  }
  let added = 0;
  for (const c of charges) {
    const amount = Math.round(Number(c?.amount) * 100) / 100;
    const kind = isCostKind(c?.kind) ? c.kind : "other";
    const label = String(c?.label ?? "").trim().slice(0, 120);
    if (!label || !Number.isFinite(amount) || amount <= 0) continue;
    const { error } = await db().from("import_costs").insert({ import_id: imp.id, kind, label, amount, allocation: chargeAllocation(kind), item_id: null, created_at: now });
    if (!error) added++;
  }
  const what = [rows.length && `${rows.length} ${rows.length === 1 ? "producto" : "productos"}`, added && `${added} ${added === 1 ? "costo" : "costos"}`].filter(Boolean).join(" y ");
  await logEvent(imp.id, auth.user.id, null, `Factura leída con IA (${String(p?.source ?? "documento").slice(0, 120)}): ${what}`, "activity");
  return done(imp.id, `Agregados ${what}.`);
}
