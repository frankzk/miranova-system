import "server-only";
import { listAccounts } from "./accounts";
import { storeDirectory } from "./contacts";
import { COUNTRIES } from "./countries";
import { listProducts } from "./queries";
import { db } from "./supabase";
import {
  isProspect, isRequestStatus, isRequestType, norm, prospectSuggestions, REQUEST_PHOTO_TYPES, requestItems, requestPhotoUrl, storeSuggestions, type DropProductRef, type ProspectSuggestion,
  type RequestItem, type RequestProduct, type StoreRequest, type StoreSuggestion,
} from "./store-requests";

// tabla que todavía no existe (migración 0044 sin aplicar): la sección se ve vacía en vez de fallar
const missingTable = (e: { code?: string }) => e.code === "42P01" || e.code === "PGRST205";

export type RequestRow = StoreRequest & { created_by_name: string | null };

/** Todas las solicitudes, de la más reciente a la más vieja (por fecha de solicitud), con el nombre de quien la cargó. */
export async function listRequests(): Promise<RequestRow[]> {
  const [{ data, error }, users, lines] = await Promise.all([
    db().from("store_requests").select("*").order("created_at", { ascending: false }).limit(5000),
    db().from("app_users").select("id, name"),
    db().from("store_request_items").select("request_id, position, product, quantity, country_quantities").order("position").limit(50000),
  ]);
  if (error) {
    if (missingTable(error)) return [];
    throw error;
  }
  // sin la migración 0047 no hay líneas: cada solicitud tiene su producto del resumen
  if (lines.error && !missingTable(lines.error)) throw lines.error;
  const byRequest = new Map<string, RequestItem[]>();
  for (const l of (lines.data ?? []) as { request_id: string; position: number; product: string; quantity: number; country_quantities?: Record<string, number> }[]) {
    byRequest.set(l.request_id, [...(byRequest.get(l.request_id) ?? []), { product: l.product, quantity: Number(l.quantity), country_quantities: l.country_quantities ?? {} }]);
  }
  const names = new Map(((users.data ?? []) as { id: string; name: string }[]).map((u) => [u.id, u.name]));
  const localDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tegucigalpa" }).format(new Date(iso));
  return ((data ?? []) as StoreRequest[])
    .map((r) => ({
      ...r,
      countries: Array.isArray(r.countries) ? r.countries : [],
      quantity: Number(r.quantity),
      items: requestItems({ product: r.product, quantity: Number(r.quantity), items: byRequest.get(r.id) }),
      status: isRequestStatus(r.status) ? r.status : "pending",
      // sin la migración de clientes potenciales, todas son pedidos de producto de tiendas
      client_kind: r.client_kind === "prospect" ? ("prospect" as const) : ("store" as const),
      request_type: isRequestType(r.request_type) ? r.request_type : ("product" as const),
      contact_phone: r.contact_phone ?? null,
      contact_email: r.contact_email ?? null,
      // sin la migración 0045, la fecha de solicitud es el día en que se cargó
      requested_at: r.requested_at ?? localDay(r.created_at),
      arrival_at: r.arrival_at ?? null,
      origin_country: r.origin_country ?? null,
      created_by_name: r.created_by ? names.get(r.created_by) ?? null : null,
    }))
    .sort((a, b) => b.requested_at.localeCompare(a.requested_at) || b.created_at.localeCompare(a.created_at));
}

/** Países que se abren sin cuenta todavía: las tiendas ya pueden pedir para ellos. */
const NEW_MARKETS = ["NI"];

/** Países donde se opera (los de las cuentas de Drop/Dropi con órdenes y los nuevos), en el orden habitual. */
export async function requestCountries(): Promise<{ code: string; name: string }[]> {
  const accounts = await listAccounts();
  const codes = new Set([...accounts.filter((a) => !a.catalog_only).map((a) => a.country), ...NEW_MARKETS]);
  return COUNTRIES.filter((c) => codes.has(c.code)).map((c) => ({ code: c.code, name: c.name }));
}

export type RequestFormOptions = { stores: StoreSuggestion[]; prospects: ProspectSuggestion[]; products: string[] };

/**
 * Sugerencias para el formulario: las tiendas de las cuentas (con su dueño y países) más las que ya
 * se cargaron a mano, los clientes potenciales ya cargados (con su contacto), y los productos nuevos,
 * los ya pedidos y los del catálogo. Si algo falla, el formulario igual funciona sin sugerencias.
 */
export async function requestFormOptions(requests: readonly StoreRequest[], created: readonly RequestProduct[] = []): Promise<RequestFormOptions> {
  const [directory, catalog] = await Promise.all([
    storeDirectory().catch((e) => (console.error("solicitudes: tiendas", e), [])),
    listProducts().catch((e) => (console.error("solicitudes: productos", e), [])),
  ]);
  const stores = storeSuggestions(directory);
  const known = new Set(stores.map((s) => norm(s.name)));
  for (const r of requests) {
    // los clientes potenciales van aparte (no son tiendas)
    if (isProspect(r) || known.has(norm(r.store_name))) continue;
    known.add(norm(r.store_name));
    stores.push({ name: r.store_name, owner: r.owner_name, countries: r.countries });
  }
  const products: string[] = [];
  const seen = new Set<string>();
  for (const name of [...created.map((p) => p.name), ...requests.flatMap((r) => requestItems(r).map((i) => i.product)), ...catalog.map((p) => p.name)]) {
    const k = norm(name ?? "");
    if (!k || seen.has(k)) continue;
    seen.add(k);
    products.push(name.trim());
  }
  return { stores, prospects: prospectSuggestions(requests), products };
}

// ─── Productos nuevos (lo que piden y todavía no está en Drop) ───

export const REQUEST_BUCKET = "request-files";

type ProductRow = { id: string; name: string; photo_path: string | null; account_id: string | null; product_external_id: string | null };

/** El producto nuevo con ese id (o null), con su foto guardada. */
export async function requestProductRow(id: string): Promise<ProductRow | null> {
  const { data, error } = await db().from("request_products").select("id, name, photo_path, account_id, product_external_id").eq("id", id).maybeSingle();
  if (error) {
    if (missingTable(error)) return null;
    throw error;
  }
  return (data as ProductRow | null) ?? null;
}

/**
 * Productos nuevos creados en Solicitudes, con el enlace a su foto y el producto de Drop con el que
 * se vincularon (si el producto ya no está en el catálogo, se muestra igual con lo que se sabe).
 * Sin la migración, ninguno.
 */
export async function listRequestProducts(): Promise<RequestProduct[]> {
  const { data, error } = await db().from("request_products").select("id, name, photo_path, account_id, product_external_id").order("name").limit(5000);
  if (error) {
    if (missingTable(error)) return [];
    throw error;
  }
  const rows = (data ?? []) as ProductRow[];
  const linked = rows.filter((r) => r.account_id && r.product_external_id);
  const drop = new Map<string, { name: string; sku: string | null; image_url: string | null }>();
  const accountName = new Map<string, string>();
  if (linked.length) {
    const [prods, accs] = await Promise.all([
      db().from("products").select("account_id, external_id, name, sku, image_url")
        .in("account_id", [...new Set(linked.map((r) => r.account_id!))]).in("external_id", [...new Set(linked.map((r) => r.product_external_id!))]),
      db().from("accounts").select("id, name"),
    ]);
    if (prods.error) console.error("solicitudes: productos vinculados", prods.error);
    for (const p of (prods.data ?? []) as { account_id: string; external_id: string; name: string; sku: string | null; image_url: string | null }[]) drop.set(`${p.account_id}:${p.external_id}`, p);
    for (const a of (accs.data ?? []) as { id: string; name: string }[]) accountName.set(a.id, a.name);
  }
  return rows.map((r) => {
    const p = r.account_id && r.product_external_id ? drop.get(`${r.account_id}:${r.product_external_id}`) : undefined;
    return {
      id: r.id,
      name: r.name,
      photo: requestPhotoUrl(r.id, r.photo_path),
      linked: r.account_id && r.product_external_id
        ? { account_id: r.account_id, external_id: r.product_external_id, name: p?.name ?? "Ya no está en el catálogo", sku: p?.sku ?? null, image_url: p?.image_url ?? null, account_name: accountName.get(r.account_id) ?? "" }
        : null,
    };
  });
}

/** Busca en el catálogo de Drop de todas las cuentas activas por nombre o SKU (para vincular un producto nuevo). */
export async function searchDropCatalog(term: string, limit = 30): Promise<DropProductRef[]> {
  // sin comodines de LIKE escritos a mano
  const q = term.trim().replace(/[%_*\\]/g, " ").replace(/\s+/g, " ").slice(0, 80);
  if (q.length < 2) return [];
  const { data: accs, error } = await db().from("accounts").select("id, name, enabled");
  if (error) throw error;
  const accounts = new Map(((accs ?? []) as { id: string; name: string; enabled: boolean }[]).filter((a) => a.enabled).map((a) => [a.id, a.name]));
  if (!accounts.size) return [];
  const cols = "account_id, external_id, name, sku, image_url";
  const ids = [...accounts.keys()];
  const [byName, bySku] = await Promise.all([
    db().from("products").select(cols).in("account_id", ids).ilike("name", `%${q}%`).order("name").limit(limit),
    db().from("products").select(cols).in("account_id", ids).ilike("sku", `%${q}%`).order("name").limit(limit),
  ]);
  if (byName.error) throw byName.error;
  if (bySku.error) throw bySku.error;
  const out = new Map<string, DropProductRef>();
  for (const p of [...(byName.data ?? []), ...(bySku.data ?? [])] as { account_id: string; external_id: string; name: string; sku: string | null; image_url: string | null }[]) {
    const k = `${p.account_id}:${p.external_id}`;
    if (!out.has(k)) out.set(k, { account_id: p.account_id, external_id: p.external_id, name: p.name, sku: p.sku, image_url: p.image_url, account_name: accounts.get(p.account_id) ?? "" });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, "es") || a.account_name.localeCompare(b.account_name, "es")).slice(0, limit);
}

/** Enlace firmado para subir la foto de un producto nuevo directo a Storage desde el navegador. */
export async function signedPhotoUpload(contentType: string): Promise<{ path: string; url: string }> {
  const ext = REQUEST_PHOTO_TYPES[contentType];
  if (!ext) throw new Error("Tipo de foto no permitido");
  const path = `products/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await db().storage.from(REQUEST_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw error ?? new Error("Storage no devolvió el enlace de subida");
  return { path, url: data.signedUrl };
}

/** Tipo y tamaño reales de la foto ya subida (de Storage, no del navegador). */
export async function storedPhoto(path: string): Promise<{ contentType: string; size: number } | null> {
  const { data, error } = await db().storage.from(REQUEST_BUCKET).info(path);
  if (error || !data) return null;
  return { contentType: String(data.contentType ?? "").toLowerCase(), size: Number(data.size ?? 0) };
}

export async function removePhotos(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await db().storage.from(REQUEST_BUCKET).remove(paths);
  if (error) throw error;
}

export async function signedPhotoRead(path: string, seconds: number): Promise<string> {
  const { data, error } = await db().storage.from(REQUEST_BUCKET).createSignedUrl(path, seconds);
  if (error || !data) throw error ?? new Error("Storage no devolvió el enlace");
  return data.signedUrl;
}
