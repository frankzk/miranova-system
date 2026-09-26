import "server-only";
import { db } from "./supabase";
import { groupById } from "./status";

export type OrderItem = {
  product_name: string;
  quantity: number;
  price: number | null;
  vendor_price: number | null;
  sku: string | null;
  image_url: string | null;
  position: number;
};

export type Order = {
  id: string;
  external_id: string;
  shopify_order: string | null;
  status: string | null;
  status_code: string | null;
  dropshipper: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  department: string | null;
  city: string | null;
  address: string | null;
  reference_point: string | null;
  notes: string | null;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  label_url: string | null;
  total: number | null;
  shipping_cost: number | null;
  vendor_amount: number | null;
  vendor_net: number | null;
  cod: boolean | null;
  paid: boolean | null;
  currency: string | null;
  ordered_at: string | null;
  first_seen_at: string;
  updated_at: string;
  account_id: string | null;
  accounts: { name: string; country: string; timezone: string } | null;
  order_items: OrderItem[];
};

export type Filters = {
  account?: string;
  group?: string; // StatusGroup
  q?: string;
  dropshipper?: string;
  carrier?: string;
  from?: string; // YYYY-MM-DD
  to?: string;
  /** estado exacto (status_code), dentro del grupo de la pestaña */
  status?: string;
  dept?: string;
  /** órdenes que contienen este producto */
  product?: string;
  sort?: Sort;
  page?: number;
};

export const SORTS = {
  recent: { label: "Más recientes", col: "ordered_at", asc: false },
  old: { label: "Más antiguas", col: "ordered_at", asc: true },
  total_desc: { label: "Total: mayor a menor", col: "total", asc: false },
  total_asc: { label: "Total: menor a mayor", col: "total", asc: true },
} as const;
export type Sort = keyof typeof SORTS;

export const PAGE_SIZE = 50;
const HN_OFFSET = "-06:00";

export function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const one = (k: string) => {
    const v = sp[k];
    const s = (Array.isArray(v) ? v[0] : v)?.trim();
    return s ? s : undefined;
  };
  return {
    account: one("account"),
    group: one("group"),
    q: one("q"),
    dropshipper: one("dropshipper"),
    carrier: one("carrier"),
    from: one("from"),
    to: one("to"),
    status: one("status"),
    dept: one("dept"),
    product: one("product"),
    sort: (Object.keys(SORTS) as Sort[]).find((k) => k === one("sort") && k !== "recent"),
    page: Math.max(1, Number(one("page") ?? 1) || 1),
  };
}

// Evita que caracteres del buscador rompan el filtro `or` de PostgREST
const clean = (s: string) => s.replace(/[,()*%\\]/g, " ").trim();

const ORDER_SELECT =
  "*, accounts(name, country, timezone), order_items(product_name, quantity, price, vendor_price, sku, image_url, position)";

// Filtro por producto: un embed aparte (`pf`, inner) filtra las órdenes sin recortar `order_items`.
const PRODUCT_EMBED = ", pf:order_items!inner(product_name)";

/** Filtros comunes a la lista y a los conteos (sin grupo ni estado exacto). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters<Q extends { eq: any; gte: any; lte: any; or: any }>(query: Q, f: Filters): Q {
  if (f.account) query = query.eq("account_id", f.account);
  if (f.dropshipper) query = query.eq("dropshipper", f.dropshipper);
  if (f.carrier) query = query.eq("carrier", f.carrier);
  if (f.dept) query = query.eq("department", f.dept);
  if (f.product) query = query.eq("pf.product_name", f.product);
  if (f.from) query = query.gte("ordered_at", `${f.from}T00:00:00${HN_OFFSET}`);
  if (f.to) query = query.lte("ordered_at", `${f.to}T23:59:59${HN_OFFSET}`);
  if (f.q) {
    const q = clean(f.q.replace(/^#/, ""));
    if (q) {
      query = query.or(
        ["external_id", "shopify_order", "customer_name", "customer_phone", "customer_email", "city", "tracking_number", "dropshipper"]
          .map((c) => `${c}.ilike.*${q}*`)
          .join(","),
      );
    }
  }
  return query;
}

function filtered(f: Filters, count = false) {
  const sort = SORTS[f.sort ?? "recent"];
  let query = db()
    .from("orders")
    .select((ORDER_SELECT + (f.product ? PRODUCT_EMBED : "")) as "*", count ? { count: "exact" } : undefined)
    .order(sort.col, { ascending: sort.asc, nullsFirst: false })
    .order("id", { ascending: sort.asc });

  const group = groupById(f.group);
  if (group) query = query.in("status_code", group.codes);
  if (f.status) query = query.eq("status_code", f.status);
  return applyFilters(query, f);
}

const sortItems = (o: Order): Order => ({
  ...o,
  order_items: [...(o.order_items ?? [])].sort((a, b) => a.position - b.position),
});

export async function listOrders(f: Filters) {
  const page = f.page ?? 1;
  const { data, error, count } = await filtered(f, true).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) throw error;
  return { orders: (data as Order[]).map(sortItems), count: count ?? 0 };
}

/** Todas las órdenes del filtro, paginando (PostgREST devuelve máx. 1000 por consulta). */
export async function listAllOrders(f: Filters, max = 50000): Promise<Order[]> {
  const out: Order[] = [];
  const step = 1000;
  for (let from = 0; from < max; from += step) {
    const { data, error } = await filtered(f).range(from, from + step - 1);
    if (error) throw error;
    out.push(...(data as Order[]).map(sortItems));
    if (data.length < step) break;
  }
  return out;
}

export type OrderDetail = Order & { raw: Record<string, unknown> | null };

export async function getOrder(id: string): Promise<OrderDetail | null> {
  const { data, error } = await db().from("orders").select(ORDER_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return sortItems(data as Order) as OrderDetail;
}

export type Facets = {
  dropshippers: string[];
  carriers: string[];
  statuses: { code: string; label: string | null; group: string | null; n: number }[];
  departments: { name: string; n: number }[];
  products: { name: string; n: number }[];
};

export async function orderFacets(account?: string): Promise<Facets> {
  const { data, error } = await db().rpc("order_facets", { p_account: account ?? null });
  if (error) throw error;
  const d = data as Partial<Facets>;
  return { dropshippers: [], carriers: [], statuses: [], departments: [], products: [], ...d };
}

export type MoneyRow = {
  currency: string;
  orders: number;
  delivered: number;
  sales: number;
  vendor_delivered: number;
  vendor_paid: number;
  vendor_unpaid: number;
  vendor_net: number;
  vendor_in_flight: number;
};

export type DayRow = { day: string; orders: number; delivered: number; problems: number };
export type RankRow = { name: string; orders: number; delivered?: number; problems?: number; units?: number };

export type Summary = {
  snapshot: Partial<Record<"dispatch" | "transit" | "delivered" | "problem" | "failed" | "cancelled" | "other", number>>;
  money: MoneyRow[];
  unpaid: { currency: string; orders: number; amount: number }[];
  daily: DayRow[];
  sellers: RankRow[];
  products: RankRow[];
  carriers: RankRow[];
};

export async function dashboardSummary(opts: {
  account?: string;
  from: Date;
  to: Date;
  tz: string;
  bucket?: "hour" | "day";
}): Promise<Summary> {
  const { data, error } = await db().rpc("dashboard_summary", {
    p_account: opts.account ?? null,
    p_from: opts.from.toISOString(),
    p_to: opts.to.toISOString(),
    p_tz: opts.tz,
    p_bucket: opts.bucket ?? "day",
  });
  if (error) throw error;
  return data as Summary;
}

export type MonthRow = {
  month: string;
  account_name: string | null;
  currency: string;
  orders: number;
  delivered: number;
  problems: number;
  cancelled: number;
  sales: number;
  vendor_delivered: number;
  vendor_paid: number;
  vendor_unpaid: number;
  vendor_net: number;
};

export async function moneyByMonth(opts: { account?: string; months: number; tz: string }): Promise<MonthRow[]> {
  const { data, error } = await db().rpc("money_by_month", {
    p_account: opts.account ?? null,
    p_months: opts.months,
    p_tz: opts.tz,
  });
  if (error) throw error;
  return data as MonthRow[];
}

/** Órdenes que requieren acción ahora (con problemas), más recientes primero. */
export async function attentionOrders(account?: string, limit = 7) {
  const f: Filters = { account, group: "problem" };
  const { data, error, count } = await filtered(f, true).range(0, limit - 1);
  if (error) throw error;
  return { orders: (data as Order[]).map(sortItems), count: count ?? 0 };
}

/** Órdenes entregadas aún sin liquidar al proveedor. */
export async function unpaidDelivered(account?: string, limit = 12) {
  let q = db()
    .from("orders")
    .select(ORDER_SELECT, { count: "exact" })
    .in("status_code", groupById("delivered")!.codes)
    .or("paid.is.null,paid.eq.false")
    .order("ordered_at", { ascending: true })
    .range(0, limit - 1);
  if (account) q = q.eq("account_id", account);
  const { data, error, count } = await q;
  if (error) throw error;
  return { orders: (data as Order[]).map(sortItems), count: count ?? 0 };
}

/** Cuántas órdenes hay en cada grupo de estado con los filtros actuales (para las pestañas). */
export async function groupCounts(f: Filters): Promise<Record<string, number>> {
  const { GROUPS } = await import("./status");
  const base = (codes?: string[]) => {
    let q = db().from("orders").select(`id${f.product ? PRODUCT_EMBED : ""}` as "id", { count: "exact", head: true });
    if (codes) q = q.in("status_code", codes);
    return applyFilters(q, f);
  };
  const entries = await Promise.all([
    base().then((r) => ["all", r.count ?? 0] as const),
    ...GROUPS.map((g) => base(g.codes).then((r) => [g.id, r.count ?? 0] as const)),
  ]);
  return Object.fromEntries(entries);
}

export type Product = {
  id: string;
  account_id: string;
  external_id: string;
  code: string | null;
  name: string;
  sku: string | null;
  status: string | null;
  price: number | null;
  suggested_price: number | null;
  stock: number | null;
  image_url: string | null;
  variants_count: number;
  currency: string | null;
  created_at_platform: string | null;
  updated_at: string;
  accounts: { name: string; timezone: string } | null;
};

/** Catálogo completo de la cuenta (paginando de 1000 en 1000). */
export async function listProducts(account?: string): Promise<Product[]> {
  const out: Product[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    let q = db()
      .from("products")
      .select("id, account_id, external_id, code, name, sku, status, price, suggested_price, stock, image_url, variants_count, currency, created_at_platform, updated_at, accounts(name, timezone)")
      .order("created_at_platform", { ascending: false, nullsFirst: false })
      .order("name")
      .range(from, from + 999);
    if (account) q = q.eq("account_id", account);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data as unknown as Product[]));
    if (data.length < 1000) break;
  }
  return out;
}

/** Unidades y órdenes por "cuenta:SKU" (o "cuenta:nombre") desde una fecha. */
export async function productSales(account: string | undefined, days: number): Promise<Record<string, { units: number; orders: number }>> {
  const { data, error } = await db().rpc("product_sales", {
    p_account: account ?? null,
    p_from: new Date(Date.now() - days * 86_400_000).toISOString(),
  });
  if (error) throw error;
  return (data ?? {}) as Record<string, { units: number; orders: number }>;
}

/** Salud de tiendas: métricas por dropshipper (ver supabase/migrations/0010_store_health.sql). */
export async function storeHealth(account?: string): Promise<import("./stores").StoreRow[]> {
  const { data, error } = await db().rpc("store_health", { p_account: account ?? null });
  if (error) throw error;
  return (data ?? []) as import("./stores").StoreRow[];
}
