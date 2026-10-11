import "server-only";
import {
  allInDrop, dropState, IMPORT_FILE_TYPES, INBOUND, landedCosts, matchNewProduct, type Allocation, type CostKind, type DigestImport, type DocKind,
  type DropState,
} from "./imports";
import type { RCost, RImport, RItem, RPayment } from "./import-reports";
import { productKey, trackOrders, type TrackedOrder } from "./inventory";
import { inventorySupply, stockEntries } from "./inventory-data";
import { db } from "./supabase";
import { toUsd } from "./wallet";

// Importaciones: lectura de la base y archivos del bucket privado import-files.

export const IMPORT_BUCKET = "import-files";

export type ImportRow = {
  id: string;
  code: string;
  supplier: string | null;
  supplier_id: string | null;
  origin: string | null;
  dest_country: string;
  status: string;
  ordered_at: string | null;
  eta: string | null;
  arrived_at: string | null;
  transport: string;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  weight_kg: number | null;
  reported_at: string | null;
  reported_by: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** seguimiento automático con 17TRACK (migración 0038) */
  track_registered?: string | null;
  track_status?: string | null;
  track_sub_status?: string | null;
  track_event?: string | null;
  track_event_at?: string | null;
  track_eta?: string | null;
  track_checked_at?: string | null;
  track_error?: string | null;
};

export type ImportItem = {
  id: string;
  import_id: string;
  account_id: string | null;
  product_external_id: string | null;
  name: string;
  sku: string | null;
  image_url: string | null;
  photo_path: string | null;
  qty: number;
  unit_cost: number;
  unit_weight_kg: number | null;
  sale_price_usd: number | null;
  position: number;
  /** recepción en la bodega (null: todavía no se cuenta) */
  received_qty: number | null;
  damaged_qty: number;
  received_note: string | null;
  received_at: string | null;
  received_by: string | null;
};

export type ImportCost = { id: string; import_id: string; kind: CostKind; label: string; amount: number; allocation: Allocation; item_id: string | null; created_at: string };
export type ImportDoc = { id: string; import_id: string; kind: DocKind; storage_path: string; filename: string | null; content_type: string; size_bytes: number | null; uploaded_by: string | null; created_at: string };
export type ImportPayment = { id: string; import_id: string; paid_at: string; amount: number; method: string; note: string | null; document_id: string | null; created_at: string };
export type ImportEvent = { id: string; import_id: string; status: string | null; note: string | null; by_user: string | null; at: string };

const ITEM_COLS =
  "id, import_id, account_id, product_external_id, name, sku, image_url, photo_path, qty, unit_cost, unit_weight_kg, sale_price_usd, position, received_qty, damaged_qty, received_note, received_at, received_by";
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const items = (rows: ImportItem[]) =>
  rows.map((i) => ({
    ...i, qty: Number(i.qty), unit_cost: Number(i.unit_cost), unit_weight_kg: num(i.unit_weight_kg), sale_price_usd: num(i.sale_price_usd),
    received_qty: num(i.received_qty), damaged_qty: Number(i.damaged_qty ?? 0),
  }));
const costs = (rows: ImportCost[]) => rows.map((c) => ({ ...c, amount: Number(c.amount) }));

export type ImportSummary = ImportRow & { lines: number; units: number; total: number; paid: number; last_event_at: string | null };

/** Última novedad (cambio de estado, nota, aviso) de cada importación. */
async function lastEvents(): Promise<Map<string, string>> {
  const { data, error } = await db().from("import_events").select("import_id, at");
  if (error) throw error;
  const out = new Map<string, string>();
  for (const e of (data ?? []) as { import_id: string; at: string }[]) if (!out.has(e.import_id) || e.at > out.get(e.import_id)!) out.set(e.import_id, e.at);
  return out;
}

/** Todas las importaciones, las más nuevas primero, con unidades, costo total, lo pagado y su última novedad. */
export async function listImports(): Promise<ImportSummary[]> {
  const [imp, it, co, pa, last] = await Promise.all([
    db().from("imports").select("*").order("created_at", { ascending: false }),
    db().from("import_items").select("id, import_id, qty, unit_cost, unit_weight_kg, received_qty, damaged_qty"),
    db().from("import_costs").select("import_id, kind, amount, allocation, item_id"),
    db().from("import_payments").select("import_id, amount"),
    lastEvents(),
  ]);
  for (const r of [imp, it, co, pa]) if (r.error) throw r.error;
  const group = <T extends { import_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.import_id, [...(m.get(r.import_id) ?? []), r]);
    return m;
  };
  const byItems = group(items((it.data ?? []) as ImportItem[]));
  const byCosts = group(costs((co.data ?? []) as ImportCost[]));
  const byPaid = group((pa.data ?? []) as { import_id: string; amount: number }[]);
  return ((imp.data ?? []) as ImportRow[]).map((r) => {
    const li = byItems.get(r.id) ?? [];
    const lc = landedCosts(li, byCosts.get(r.id) ?? []);
    return {
      ...r,
      weight_kg: num(r.weight_kg),
      lines: li.length,
      units: lc.totals.units,
      total: lc.totals.total,
      paid: (byPaid.get(r.id) ?? []).reduce((t, p) => t + Number(p.amount), 0),
      last_event_at: last.get(r.id) ?? null,
    };
  });
}

// ─── Proveedores ───

export type Supplier = {
  id: string; name: string; origin: string | null; contact: string | null; whatsapp: string | null; email: string | null;
  payment_terms: string | null; notes: string | null; created_at: string;
};

/** Proveedores guardados, por nombre (vacío si la tabla todavía no existe). */
export async function listSuppliers(): Promise<Supplier[]> {
  const { data, error } = await db().from("import_suppliers").select("*").order("name");
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw error;
  }
  return (data ?? []) as Supplier[];
}

/** Todo lo que necesitan los reportes y el directorio de proveedores. */
export async function reportData(): Promise<{ imports: RImport[]; items: RItem[]; costs: RCost[]; payments: RPayment[] }> {
  const [imp, it, co, pa] = await Promise.all([
    db().from("imports").select("id, code, supplier_id, supplier, dest_country, status, ordered_at, created_at, eta, arrived_at"),
    db().from("import_items").select("id, import_id, account_id, product_external_id, name, sku, qty, unit_cost, unit_weight_kg, received_qty, damaged_qty"),
    db().from("import_costs").select("import_id, kind, amount, allocation, item_id"),
    db().from("import_payments").select("import_id, paid_at, amount"),
  ]);
  for (const r of [imp, it, co, pa]) if (r.error) throw r.error;
  return {
    imports: (imp.data ?? []) as RImport[],
    items: ((it.data ?? []) as RItem[]).map((i) => ({
      ...i, qty: Number(i.qty), unit_cost: Number(i.unit_cost), unit_weight_kg: num(i.unit_weight_kg), received_qty: num(i.received_qty), damaged_qty: Number(i.damaged_qty ?? 0),
    })),
    costs: ((co.data ?? []) as RCost[]).map((c) => ({ ...c, amount: Number(c.amount) })),
    payments: ((pa.data ?? []) as RPayment[]).map((p) => ({ ...p, amount: Number(p.amount) })),
  };
}

export type ImportDetail = {
  imp: ImportRow;
  items: ImportItem[];
  costs: ImportCost[];
  docs: ImportDoc[];
  payments: ImportPayment[];
  events: ImportEvent[];
  /** id de usuario → nombre (historial, quién reportó) */
  people: Record<string, string>;
};

export async function getImport(id: string): Promise<ImportDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data: imp, error } = await db().from("imports").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!imp) return null;
  const [it, co, dc, pa, ev, us] = await Promise.all([
    db().from("import_items").select(ITEM_COLS).eq("import_id", id).order("position").order("created_at"),
    db().from("import_costs").select("*").eq("import_id", id).order("created_at"),
    db().from("import_documents").select("*").eq("import_id", id).order("created_at"),
    db().from("import_payments").select("*").eq("import_id", id).order("paid_at"),
    db().from("import_events").select("*").eq("import_id", id).order("at", { ascending: false }),
    db().from("app_users").select("id, name"),
  ]);
  for (const r of [it, co, dc, pa, ev, us]) if (r.error) throw r.error;
  return {
    imp: { ...(imp as ImportRow), weight_kg: num((imp as ImportRow).weight_kg) },
    items: items((it.data ?? []) as ImportItem[]),
    costs: costs((co.data ?? []) as ImportCost[]),
    docs: (dc.data ?? []) as ImportDoc[],
    payments: ((pa.data ?? []) as ImportPayment[]).map((p) => ({ ...p, amount: Number(p.amount) })),
    events: (ev.data ?? []) as ImportEvent[],
    people: Object.fromEntries(((us.data ?? []) as { id: string; name: string }[]).map((u) => [u.id, u.name])),
  };
}

export type ProductChoice = {
  account_id: string;
  external_id: string;
  name: string;
  sku: string | null;
  image_url: string | null;
  /** precio de proveedor en Drop, convertido a USD (null si no hay tipo de cambio) */
  price_usd: number | null;
};

/** Productos del catálogo de las cuentas del país (para elegir qué viene en la importación). */
export async function productChoices(country: string): Promise<ProductChoice[]> {
  const { data: accs, error } = await db().from("accounts").select("id, country, currency, enabled, catalog_only");
  if (error) throw error;
  const ids = ((accs ?? []) as { id: string; country: string; enabled: boolean; catalog_only: boolean | null }[])
    .filter((a) => a.country === country && a.enabled && !a.catalog_only)
    .map((a) => a.id);
  if (!ids.length) return [];
  const currency = new Map(((accs ?? []) as { id: string; currency: string }[]).map((a) => [a.id, a.currency]));
  const rates = await usdRates();
  const out: ProductChoice[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error: e } = await db()
      .from("products")
      .select("account_id, external_id, name, sku, image_url, price")
      .in("account_id", ids)
      .order("name")
      .range(from, from + 999);
    if (e) throw e;
    for (const p of (data ?? []) as { account_id: string; external_id: string; name: string; sku: string | null; image_url: string | null; price: number | null }[]) {
      const price = p.price === null ? null : Number(p.price);
      out.push({
        account_id: p.account_id, external_id: p.external_id, name: p.name, sku: p.sku, image_url: p.image_url,
        price_usd: price === null ? null : toUsd(price, currency.get(p.account_id) ?? "USD", rates.get(p.account_id) ?? null),
      });
    }
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

async function usdRates(): Promise<Map<string, number | null>> {
  const { data } = await db().from("account_fx").select("account_id, usd_rate");
  return new Map(((data ?? []) as { account_id: string; usd_rate: number | null }[]).map((r) => [r.account_id, r.usd_rate === null ? null : Number(r.usd_rate)]));
}

/** Precio de venta en USD de cada línea: el escrito a mano, o el de Drop del producto enlazado. */
export async function salePrices(list: ImportItem[]): Promise<Map<string, number | null>> {
  const linked = list.filter((i) => i.account_id && i.product_external_id && i.sale_price_usd === null);
  const out = new Map<string, number | null>(list.map((i) => [i.id, i.sale_price_usd]));
  if (!linked.length) return out;
  const accIds = [...new Set(linked.map((i) => i.account_id!))];
  const [{ data: prods }, { data: accs }, rates] = await Promise.all([
    db().from("products").select("account_id, external_id, price").in("account_id", accIds).in("external_id", linked.map((i) => i.product_external_id!)),
    db().from("accounts").select("id, currency"),
    usdRates(),
  ]);
  const currency = new Map(((accs ?? []) as { id: string; currency: string }[]).map((a) => [a.id, a.currency]));
  const price = new Map(((prods ?? []) as { account_id: string; external_id: string; price: number | null }[]).map((p) => [`${p.account_id}:${p.external_id}`, p.price === null ? null : Number(p.price)]));
  for (const i of linked) {
    const p = price.get(`${i.account_id}:${i.product_external_id}`);
    out.set(i.id, p === undefined || p === null ? null : toUsd(p, currency.get(i.account_id!) ?? "USD", rates.get(i.account_id!) ?? null));
  }
  return out;
}

// ─── Drop: cómo va cada línea ───

/**
 * Estado de cada línea frente a Drop: si ya entró (y cuánto), si sigue en camino o si es un
 * producto nuevo sin enlazar. Usa los mismos pedidos que Inventario (reposiciones e importaciones
 * de la cuenta) y las entradas de mercadería de los movimientos de Drop.
 */
export async function dropStates(list: ImportItem[], today: string): Promise<Map<string, DropState>> {
  const out = new Map<string, DropState>(list.map((i) => [i.id, dropState(i, undefined)]));
  const linked = list.filter((i) => i.account_id && i.product_external_id);
  if (!linked.length) return out;
  const accounts = [...new Set(linked.map((i) => i.account_id!))];
  const keys = new Set(linked.map((i) => productKey(i.account_id!, i.product_external_id!)));
  const orders = (await Promise.all(accounts.map((a) => inventorySupply(a)))).flatMap((s) => s.orders).filter((o) => keys.has(productKey(o.account_id, o.product_external_id)));
  const oldest = orders.map((o) => Date.parse(o.ordered_at)).filter(Number.isFinite).reduce((a, b) => Math.min(a, b), Date.now());
  const entries = await stockEntries(linked.map((i) => ({ account_id: i.account_id!, external_id: i.product_external_id! })), new Date(oldest - 86_400_000).toISOString());
  const byItem = new Map<string, TrackedOrder>();
  for (const key of keys) {
    for (const t of trackOrders(orders.filter((o) => productKey(o.account_id, o.product_external_id) === key), entries.get(key) ?? [], today)) {
      if (t.import) byItem.set(t.import.item_id, t);
    }
  }
  for (const i of list) out.set(i.id, dropState(i, byItem.get(i.id)));
  return out;
}

/** Importaciones para el correo diario (sin montos). */
export async function digestImports(): Promise<DigestImport[]> {
  const { data, error } = await db().from("imports").select("id, code, supplier, dest_country, status, eta, reported_at").in("status", ["quote", ...INBOUND]);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw error;
  }
  const list = (data ?? []) as Omit<DigestImport, "units" | "last_event_at">[];
  if (!list.length) return [];
  const [{ data: its }, last] = await Promise.all([db().from("import_items").select("import_id, qty").in("import_id", list.map((i) => i.id)), lastEvents()]);
  const units = new Map<string, number>();
  for (const i of (its ?? []) as { import_id: string; qty: number }[]) units.set(i.import_id, (units.get(i.import_id) ?? 0) + Number(i.qty));
  return list.map((i) => ({ ...i, units: units.get(i.id) ?? 0, last_event_at: last.get(i.id) ?? null }));
}

// ─── Sincronización ───

/** Productos de importaciones por llegar (en aduana o después, o con llegada en 5 días): sus movimientos se revisan primero. */
export async function productsToWatch(accountId: string, today: string): Promise<string[]> {
  const { data: its, error } = await db().from("import_items").select("import_id, product_external_id").eq("account_id", accountId);
  if (error || !its?.length) return [];
  const ids = [...new Set((its as { import_id: string }[]).map((i) => i.import_id))];
  const { data: imps } = await db().from("imports").select("id, status, eta").in("id", ids).in("status", INBOUND);
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 5 * 86_400_000).toISOString().slice(0, 10);
  const near = new Set(
    ((imps ?? []) as { id: string; status: string; eta: string | null }[])
      .filter((i) => ["customs", "released", "to_warehouse", "received"].includes(i.status) || (i.eta !== null && i.eta <= soon))
      .map((i) => i.id),
  );
  return [...new Set((its as { import_id: string; product_external_id: string | null }[]).filter((i) => near.has(i.import_id) && i.product_external_id).map((i) => i.product_external_id!))];
}

/**
 * Pasa a "Ingresado en Drop" las importaciones en camino cuyos productos (todos enlazados) ya
 * aparecen como entrada de mercadería en Drop. Devuelve cuántas avanzaron.
 */
export async function advanceImports(accountId: string, today: string): Promise<number> {
  const { data: mine, error } = await db().from("import_items").select("import_id").eq("account_id", accountId);
  if (error || !mine?.length) return 0;
  const { data: imps } = await db()
    .from("imports")
    .select("id, status, arrived_at")
    .in("id", [...new Set((mine as { import_id: string }[]).map((i) => i.import_id))])
    .in("status", INBOUND);
  const list = (imps ?? []) as { id: string; status: string; arrived_at: string | null }[];
  if (!list.length) return 0;
  const { data: all, error: e } = await db().from("import_items").select(ITEM_COLS).in("import_id", list.map((i) => i.id));
  if (e) throw e;
  const lines = items((all ?? []) as ImportItem[]);
  const states = await dropStates(lines, today);
  let moved = 0;
  for (const imp of list) {
    const r = allInDrop(lines.filter((i) => i.import_id === imp.id), states);
    if (!r.done) continue;
    const now = new Date().toISOString();
    const { data: done } = await db()
      .from("imports")
      .update({ status: "in_drop", arrived_at: imp.arrived_at ?? r.at!.slice(0, 10), updated_at: now })
      .eq("id", imp.id)
      .in("status", INBOUND)
      .select("id");
    if (!done?.length) continue;
    await db().from("import_events").insert({ import_id: imp.id, status: "in_drop", note: `Drop registró la entrada de ${r.units.toLocaleString("en-US")} u.`, by_user: null, at: now });
    moved++;
  }
  return moved;
}

/**
 * Enlaza los productos nuevos de las importaciones a este país con el producto de Drop que les
 * corresponde (por SKU o nombre), cuando ya aparece en el catálogo. Devuelve cuántos enlazó.
 */
export async function linkNewProducts(accountId: string, country: string): Promise<number> {
  const { data: imps, error } = await db().from("imports").select("id").eq("dest_country", country).in("status", ["quote", ...INBOUND]);
  if (error || !imps?.length) return 0;
  const { data: loose } = await db()
    .from("import_items")
    .select("id, import_id, name, sku, image_url, photo_path, product_external_id")
    .in("import_id", (imps as { id: string }[]).map((i) => i.id))
    .is("product_external_id", null);
  const pending = (loose ?? []) as { id: string; import_id: string; name: string; sku: string | null; image_url: string | null; photo_path: string | null }[];
  if (!pending.length) return 0;
  // de a 1000 (el máximo por consulta)
  const catalog: { external_id: string; name: string; sku: string | null; code: string | null; image_url: string | null }[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data: page, error: e } = await db().from("products").select("external_id, name, sku, code, image_url").eq("account_id", accountId).order("external_id").range(from, from + 999);
    if (e) throw e;
    catalog.push(...((page ?? []) as typeof catalog));
    if ((page ?? []).length < 1000) break;
  }
  let linked = 0;
  for (const it of pending) {
    const p = matchNewProduct(it, catalog);
    if (!p) continue;
    const { data: done } = await db()
      .from("import_items")
      .update({ account_id: accountId, product_external_id: p.external_id, image_url: it.photo_path ? it.image_url : it.image_url ?? p.image_url })
      .eq("id", it.id)
      .is("product_external_id", null)
      .select("id");
    if (!done?.length) continue;
    await db().from("import_events").insert({ import_id: it.import_id, status: null, note: `${it.name}: enlazado con el producto de Drop "${p.name}"`, by_user: null, at: new Date().toISOString() });
    linked++;
  }
  return linked;
}

// ─── Archivos ───

/** Enlace firmado para subir un archivo directo a Storage desde el navegador. */
export async function signedUpload(importId: string, folder: "docs" | "items", contentType: string): Promise<{ path: string; url: string }> {
  const ext = IMPORT_FILE_TYPES[contentType]?.ext;
  if (!ext) throw new Error("Tipo de archivo no permitido");
  const path = `${importId}/${folder}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await db().storage.from(IMPORT_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw error ?? new Error("Storage no devolvió el enlace de subida");
  return { path, url: data.signedUrl };
}

/** Tipo y tamaño reales del archivo ya subido (de Storage, no del navegador). */
export async function storedFile(path: string): Promise<{ contentType: string; size: number } | null> {
  const { data, error } = await db().storage.from(IMPORT_BUCKET).info(path);
  if (error || !data) return null;
  return { contentType: String(data.contentType ?? "").toLowerCase(), size: Number(data.size ?? 0) };
}

export async function removeFiles(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await db().storage.from(IMPORT_BUCKET).remove(paths);
  if (error) throw error;
}

export async function signedRead(path: string, seconds: number, download?: string): Promise<string> {
  const { data, error } = await db().storage.from(IMPORT_BUCKET).createSignedUrl(path, seconds, download ? { download } : undefined);
  if (error || !data) throw error ?? new Error("Storage no devolvió el enlace");
  return data.signedUrl;
}
