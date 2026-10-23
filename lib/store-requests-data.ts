import "server-only";
import { listAccounts } from "./accounts";
import { storeDirectory } from "./contacts";
import { COUNTRIES } from "./countries";
import { listProducts } from "./queries";
import { db } from "./supabase";
import { isRequestStatus, norm, storeSuggestions, type StoreRequest, type StoreSuggestion } from "./store-requests";

// tabla que todavía no existe (migración 0044 sin aplicar): la sección se ve vacía en vez de fallar
const missingTable = (e: { code?: string }) => e.code === "42P01" || e.code === "PGRST205";

export type RequestRow = StoreRequest & { created_by_name: string | null };

/** Todas las solicitudes, de la más reciente a la más vieja (por fecha de solicitud), con el nombre de quien la cargó. */
export async function listRequests(): Promise<RequestRow[]> {
  const [{ data, error }, users] = await Promise.all([
    db().from("store_requests").select("*").order("created_at", { ascending: false }).limit(5000),
    db().from("app_users").select("id, name"),
  ]);
  if (error) {
    if (missingTable(error)) return [];
    throw error;
  }
  const names = new Map(((users.data ?? []) as { id: string; name: string }[]).map((u) => [u.id, u.name]));
  const localDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tegucigalpa" }).format(new Date(iso));
  return ((data ?? []) as StoreRequest[])
    .map((r) => ({
      ...r,
      countries: Array.isArray(r.countries) ? r.countries : [],
      quantity: Number(r.quantity),
      status: isRequestStatus(r.status) ? r.status : "pending",
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

export type RequestFormOptions = { stores: StoreSuggestion[]; products: string[] };

/**
 * Sugerencias para el formulario: las tiendas de las cuentas (con su dueño y países) más las que ya
 * se cargaron a mano, y los productos del catálogo más los ya pedidos. Si algo falla, el formulario
 * igual funciona sin sugerencias.
 */
export async function requestFormOptions(requests: readonly StoreRequest[]): Promise<RequestFormOptions> {
  const [directory, catalog] = await Promise.all([
    storeDirectory().catch((e) => (console.error("solicitudes: tiendas", e), [])),
    listProducts().catch((e) => (console.error("solicitudes: productos", e), [])),
  ]);
  const stores = storeSuggestions(directory);
  const known = new Set(stores.map((s) => norm(s.name)));
  for (const r of requests) {
    if (known.has(norm(r.store_name))) continue;
    known.add(norm(r.store_name));
    stores.push({ name: r.store_name, owner: r.owner_name, countries: r.countries });
  }
  const products: string[] = [];
  const seen = new Set<string>();
  for (const name of [...requests.map((r) => r.product), ...catalog.map((p) => p.name)]) {
    const k = norm(name ?? "");
    if (!k || seen.has(k)) continue;
    seen.add(k);
    products.push(name.trim());
  }
  return { stores, products };
}
