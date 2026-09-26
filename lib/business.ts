// Vista "Negocio": tipos de business_overview (migración 0011) y la lógica de
// presentación que no depende de la base (variaciones, concentración, lectura de productos).

export type CountryRow = {
  account_id: string;
  account: string;
  country: string;
  currency: string;
  orders: number;
  prev_orders: number;
  received: number;
  cancelled: number;
  delivered: number;
  failed: number;
  net_usd: number;
  prev_net_usd: number;
  stores: number;
};

export type StoreFlow = "new" | "lost" | "recovered" | "falling" | "growing" | "steady";
export type StoreItem = { account: string; country: string; name: string; cur: number; prev: number; flow: StoreFlow };

export type ProductRow = {
  account: string;
  country: string;
  name: string;
  units: number;
  prev_units: number;
  stores: number;
  delivered: number;
  failed: number;
  vendor_usd: number;
};

export type CarrierRow = {
  name: string;
  account: string;
  country: string;
  orders: number;
  delivered: number;
  failed: number;
  h_to_dispatch: number | null;
  d_to_deliver: number | null;
  d_to_deliver_p90: number | null;
};

export type DepartmentRow = { name: string; account: string; country: string; closed: number; failed: number; rate: number };

export type BusinessOverview = {
  days: number;
  country: string | null;
  countries: CountryRow[];
  stores: {
    active: number;
    new: number;
    lost: number;
    recovered: number;
    growing: number;
    falling: number;
    total: number;
    top: StoreItem[];
    losing: StoreItem[];
  };
  products: ProductRow[];
  carriers: CarrierRow[];
  departments: DepartmentRow[];
};

export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];
export const parsePeriod = (v: string | undefined): Period => (PERIODS.find((p) => String(p) === v) ?? 30);

/** Variación porcentual entera; null si no hay base para comparar. */
export function change(cur: number, prev: number): number | null {
  return prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
}

/** Entregados ÷ (entregados + no entregados); null si no hay pedidos cerrados. */
export function deliveryRate(delivered: number, failed: number): number | null {
  const closed = delivered + failed;
  return closed > 0 ? delivered / closed : null;
}

/** Participación de las primeras 1, 3 y 5 tiendas en los pedidos del período. */
export function concentration(top: StoreItem[], total: number): { top1: number; top3: number; top5: number } {
  const share = (n: number) => (total > 0 ? top.slice(0, n).reduce((t, s) => t + s.cur, 0) / total : 0);
  return { top1: share(1), top3: share(3), top5: share(5) };
}

export type ProductRead = "scale" | "defend" | "emerging" | "review" | "stopped";
export const PRODUCT_READ: Record<ProductRead, { label: string; hint: string; tone: "success" | "info" | "warning" | "danger" | "neutral" }> = {
  scale: { label: "Escalar", hint: "Mucho volumen y creciendo: asegurar stock e impulsar con más tiendas", tone: "success" },
  defend: { label: "Defender", hint: "Mucho volumen pero cayendo: revisar precio, stock o tiendas que lo dejaron", tone: "warning" },
  emerging: { label: "Emergente", hint: "Poco volumen pero creciendo: probar en más tiendas o países", tone: "info" },
  review: { label: "Revisar", hint: "Poco volumen y sin crecer: decidir si seguir comprándolo", tone: "neutral" },
  stopped: { label: "Se detuvo", hint: "Vendía en el período anterior y ahora no", tone: "danger" },
};

/**
 * Lectura de cada producto en cuatro cuadrantes: volumen (sobre o bajo la mediana de
 * unidades del período) × tendencia (crece o no frente al período anterior).
 */
export function readProducts(rows: ProductRow[]): Map<ProductRow, ProductRead> {
  const selling = rows.filter((r) => r.units > 0).map((r) => r.units).sort((a, b) => a - b);
  const mid = Math.floor(selling.length / 2);
  const median = selling.length === 0 ? 0 : selling.length % 2 ? selling[mid] : (selling[mid - 1] + selling[mid]) / 2;
  const out = new Map<ProductRow, ProductRead>();
  for (const r of rows) {
    if (r.units === 0) out.set(r, "stopped");
    else {
      const high = r.units >= median;
      const growing = r.units >= r.prev_units;
      out.set(r, high ? (growing ? "scale" : "defend") : growing ? "emerging" : "review");
    }
  }
  return out;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Para cada producto, los otros países donde se vende un producto con el mismo nombre de catálogo. */
export function otherCountries(rows: ProductRow[]): Map<ProductRow, string[]> {
  const byName = new Map<string, ProductRow[]>();
  for (const r of rows) {
    if (r.units === 0) continue;
    const k = norm(r.name);
    byName.set(k, [...(byName.get(k) ?? []), r]);
  }
  const out = new Map<ProductRow, string[]>();
  for (const r of rows) {
    const peers = (byName.get(norm(r.name)) ?? []).filter((p) => p.country !== r.country);
    out.set(r, [...new Set(peers.map((p) => p.country))].sort());
  }
  return out;
}

export const STORE_FLOW: Record<StoreFlow, { label: string; tone: "success" | "info" | "warning" | "danger" | "neutral" }> = {
  new: { label: "Nueva", tone: "info" },
  recovered: { label: "Recuperada", tone: "success" },
  growing: { label: "Creciendo", tone: "success" },
  steady: { label: "Estable", tone: "neutral" },
  falling: { label: "Cayendo", tone: "warning" },
  lost: { label: "Perdida", tone: "danger" },
};
