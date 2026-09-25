import "server-only";
import { db } from "./supabase";

export type OrderItem = {
  product_name: string;
  quantity: number;
  price: number | null;
  sku: string | null;
  image_url: string | null;
  position: number;
};

export type Order = {
  id: string;
  external_id: string;
  shopify_order: string | null;
  status: string | null;
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
  total: number | null;
  currency: string | null;
  ordered_at: string | null;
  first_seen_at: string;
  updated_at: string;
  account_id: string | null;
  accounts: { name: string; country: string } | null;
  order_items: OrderItem[];
};

export type Filters = {
  account?: string;
  q?: string;
  status?: string;
  dropshipper?: string;
  carrier?: string;
  from?: string; // YYYY-MM-DD (hora Honduras)
  to?: string;
  page?: number;
};

export const PAGE_SIZE = 50;

export function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const one = (k: string) => {
    const v = sp[k];
    const s = (Array.isArray(v) ? v[0] : v)?.trim();
    return s ? s : undefined;
  };
  return {
    account: one("account"),
    q: one("q"),
    status: one("status"),
    dropshipper: one("dropshipper"),
    carrier: one("carrier"),
    from: one("from"),
    to: one("to"),
    page: Math.max(1, Number(one("page") ?? 1) || 1),
  };
}

// Evita que caracteres del buscador rompan el filtro `or` de PostgREST
const clean = (s: string) => s.replace(/[,()*%\\]/g, " ").trim();

export async function listOrders(f: Filters, opts: { all?: boolean } = {}) {
  let query = db()
    .from("orders")
    .select("*, accounts(name, country), order_items(product_name, quantity, price, sku, image_url, position)", { count: "exact" })
    .order("ordered_at", { ascending: false, nullsFirst: false })
    .order("first_seen_at", { ascending: false });

  if (f.account) query = query.eq("account_id", f.account);
  if (f.status) query = query.eq("status", f.status);
  if (f.dropshipper) query = query.eq("dropshipper", f.dropshipper);
  if (f.carrier) query = query.eq("carrier", f.carrier);
  if (f.from) query = query.gte("ordered_at", `${f.from}T00:00:00-06:00`);
  if (f.to) query = query.lte("ordered_at", `${f.to}T23:59:59-06:00`);
  if (f.q) {
    const q = clean(f.q.replace(/^#/, ""));
    if (q) {
      query = query.or(
        ["external_id", "shopify_order", "customer_name", "customer_phone", "customer_email", "city", "tracking_number"]
          .map((c) => `${c}.ilike.*${q}*`)
          .join(","),
      );
    }
  }

  if (!opts.all) {
    const page = f.page ?? 1;
    query = query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  } else {
    query = query.limit(10000);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  const orders = (data as Order[]).map((o) => ({
    ...o,
    order_items: [...(o.order_items ?? [])].sort((a, b) => a.position - b.position),
  }));
  return { orders, count: count ?? 0 };
}

export async function getOrder(id: string): Promise<(Order & { raw: unknown }) | null> {
  const { data, error } = await db()
    .from("orders")
    .select("*, accounts(name, country), order_items(product_name, quantity, price, sku, image_url, position)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  data.order_items.sort((a: OrderItem, b: OrderItem) => a.position - b.position);
  return data;
}

/** Valores distintos para los selects de filtro. */
export async function filterOptions() {
  const { data, error } = await db()
    .from("orders")
    .select("status, dropshipper, carrier")
    .limit(5000);
  if (error) throw error;
  const uniq = (k: "status" | "dropshipper" | "carrier") =>
    [...new Set(data.map((r) => r[k]).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
  return { statuses: uniq("status"), dropshippers: uniq("dropshipper"), carriers: uniq("carrier") };
}

/** Resumen del día (hora de Honduras) para las tarjetas del panel. */
export async function todayStats(today: string, account?: string) {
  let q = db()
    .from("orders")
    .select("total, status, currency")
    .gte("ordered_at", `${today}T00:00:00-06:00`)
    .lte("ordered_at", `${today}T23:59:59-06:00`)
    .limit(10000);
  if (account) q = q.eq("account_id", account);
  const { data, error } = await q;
  if (error) throw error;
  // no se suman monedas distintas: un total por moneda
  const sums = new Map<string, number>();
  for (const r of data) sums.set(r.currency ?? "HNL", (sums.get(r.currency ?? "HNL") ?? 0) + Number(r.total ?? 0));
  return {
    count: data.length,
    sums: [...sums].map(([currency, sum]) => ({ currency, sum })),
    pending: data.filter((r) => /pendiente|pending/i.test(String(r.status ?? ""))).length,
  };
}

export async function lastIngest() {
  const { data } = await db()
    .from("ingest_log")
    .select("received_at, source, orders_found")
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { received_at: string; source: string; orders_found: number } | null;
}
