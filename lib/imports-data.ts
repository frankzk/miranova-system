import "server-only";
import { IMPORT_FILE_TYPES, landedCosts, type Allocation, type CostKind, type DocKind } from "./imports";
import { db } from "./supabase";
import { toUsd } from "./wallet";

// Importaciones: lectura de la base y archivos del bucket privado import-files.

export const IMPORT_BUCKET = "import-files";

export type ImportRow = {
  id: string;
  code: string;
  supplier: string | null;
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
};

export type ImportCost = { id: string; import_id: string; kind: CostKind; label: string; amount: number; allocation: Allocation; item_id: string | null; created_at: string };
export type ImportDoc = { id: string; import_id: string; kind: DocKind; storage_path: string; filename: string | null; content_type: string; size_bytes: number | null; uploaded_by: string | null; created_at: string };
export type ImportPayment = { id: string; import_id: string; paid_at: string; amount: number; method: string; note: string | null; document_id: string | null; created_at: string };
export type ImportEvent = { id: string; import_id: string; status: string | null; note: string | null; by_user: string | null; at: string };

const ITEM_COLS = "id, import_id, account_id, product_external_id, name, sku, image_url, photo_path, qty, unit_cost, unit_weight_kg, sale_price_usd, position";
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const items = (rows: ImportItem[]) => rows.map((i) => ({ ...i, qty: Number(i.qty), unit_cost: Number(i.unit_cost), unit_weight_kg: num(i.unit_weight_kg), sale_price_usd: num(i.sale_price_usd) }));
const costs = (rows: ImportCost[]) => rows.map((c) => ({ ...c, amount: Number(c.amount) }));

export type ImportSummary = ImportRow & { lines: number; units: number; total: number; paid: number };

/** Todas las importaciones, las más nuevas primero, con unidades, costo total y lo pagado. */
export async function listImports(): Promise<ImportSummary[]> {
  const [imp, it, co, pa] = await Promise.all([
    db().from("imports").select("*").order("created_at", { ascending: false }),
    db().from("import_items").select("id, import_id, qty, unit_cost, unit_weight_kg"),
    db().from("import_costs").select("import_id, kind, amount, allocation, item_id"),
    db().from("import_payments").select("import_id, amount"),
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
    };
  });
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
