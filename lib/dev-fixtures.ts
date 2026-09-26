// Datos de prueba para desarrollo local del panel (MIRANOVA_FIXTURES=1).
// Simula el subconjunto del cliente de Supabase que usa la app, con órdenes
// sintéticas (clientes inventados). Nunca se activa en Vercel.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = Record<string, any>;

const DAY = 86_400_000;
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];

const FIRST = ["Norma", "Luis", "Karla", "José", "María", "Carlos", "Dania", "Óscar", "Yesenia", "Kevin", "Iris", "Marvin", "Sofía", "Héctor", "Paola", "Wilmer"];
const LAST = ["García", "Mejía", "Hernández", "López", "Martínez", "Rodríguez", "Flores", "Reyes", "Aguilar", "Castro", "Zelaya", "Pineda"];
const PLACES_HN = [["San Pedro Sula", "Cortés"], ["Tegucigalpa", "Francisco Morazán"], ["La Ceiba", "Atlántida"], ["Nueva Arcadia", "Copán"], ["Choluteca", "Choluteca"], ["El Progreso", "Yoro"], ["Comayagua", "Comayagua"], ["Juticalpa", "Olancho"]];
const PLACES_GT = [["Mixco", "Guatemala"], ["Quetzaltenango", "Quetzaltenango"], ["Escuintla", "Escuintla"], ["Cobán", "Alta Verapaz"]];
const SELLERS = ["Velora Honduras", "ZONAHN", "Trendyhaus", "Nutralix", "Noelia Home", "MercaGo HN"];
const PRODUCTS = [
  ["PRODUCTO EXCLUSIVO DLG", 589.67, 319],
  ["Sovexa Cayenne Pepper Suplemento Botánico para Circulación Saludable 60 Cápsulas", 575.28, 290],
  ["Lymphatic Drainage - Gotas de drenaje linfático 100 ml", 699, 330],
  ["Suplemento Natural para Hígado y Drenaje Linfático", 602.36, 305],
  ["NAD Mens Complex Energía Rendimiento y Vitalidad Masculina 60 Cápsulas", 799, 360],
  ["Cinturón sin Hebilla Pack de 5", 499, 210],
] as const;
const STATUSES: [string, string, number][] = [
  ["4", "Entregado", 38], ["3", "En ruta a destino", 16], ["2", "Recolectado", 6], ["fulfilled", "Creado en sistema", 7],
  ["registered", "Pendiente", 5], ["pending_correction", "Verificar", 4], ["6", "Problemas en gestión", 6],
  ["8", "No entregado", 9], ["5", "Guía cancelada", 3], ["cancelled", "Orden cancelada", 4], ["rejected", "Orden rechazada", 2],
];
const weighted = () => {
  const total = STATUSES.reduce((t, s) => t + s[2], 0);
  let r = rand() * total;
  for (const s of STATUSES) if ((r -= s[2]) <= 0) return s;
  return STATUSES[0];
};

const ACCOUNTS: Row[] = [
  {
    id: "11111111-1111-4111-8111-111111111111", name: "Drop Honduras", platform: "soydrop", country: "HN", currency: "HNL",
    timezone: "America/Tegucigalpa", login_email: "proveedor@example.com", password_enc: "x", platform_ref: "r1",
    platform_ref_name: "MIRANOVA", session_enc: null, orders_path: "/orders", geo: null, backfill_cursor: null, enabled: true,
    products_path: "/products/", products_sync_at: new Date(Date.now() - 4 * 60_000).toISOString(), products_sync_msg: "8 productos actualizados",
    last_sync_at: new Date(Date.now() - 4 * 60_000).toISOString(), last_sync_ok: true, last_sync_msg: "212 pedidos actualizados",
    debug: null, created_at: "2026-09-25T00:00:00Z",
  },
  {
    id: "22222222-2222-4222-8222-222222222222", name: "Drop Guatemala", platform: "soydrop", country: "GT", currency: "GTQ",
    timezone: "America/Guatemala", login_email: "proveedor@example.com", password_enc: "x", platform_ref: "r2",
    platform_ref_name: "MIRANOVA GT", session_enc: null, orders_path: "/orders", geo: null, backfill_cursor: "2026-06-01T00:00:00Z",
    enabled: true, last_sync_at: new Date(Date.now() - 26 * 60_000).toISOString(), last_sync_ok: false,
    last_sync_msg: "Correo o contraseña incorrectos (Drop respondió 401)", debug: null, created_at: "2026-09-25T01:00:00Z",
  },
];

function makeOrders(): Row[] {
  const out: Row[] = [];
  let n = 1790373164131;
  for (let i = 0; i < 420; i++) {
    const gt = rand() < 0.22;
    const acc = gt ? ACCOUNTS[1] : ACCOUNTS[0];
    const ageDays = Math.pow(rand(), 1.3) * 88;
    const at = new Date(Date.now() - ageDays * DAY);
    let st = weighted();
    if (ageDays < 2 && (st[0] === "4" || st[0] === "8")) st = STATUSES[3];
    const [city, dept] = pick(gt ? PLACES_GT : PLACES_HN);
    const lines = rand() < 0.2 ? 2 : 1;
    const items = Array.from({ length: lines }, (_, k) => {
      const p = pick(PRODUCTS as unknown as (readonly [string, number, number])[]);
      const q = rand() < 0.25 ? 2 + Math.floor(rand() * 2) : 1;
      const fx = gt ? 0.31 : 1;
      return { product_name: p[0], quantity: q, price: +(p[1] * q * fx).toFixed(2), vendor_price: +(p[2] * q * fx).toFixed(2), sku: String(8668450 + k), image_url: null, position: k };
    });
    const total = +items.reduce((t, x) => t + x.price, 0).toFixed(2);
    const vendor = +items.reduce((t, x) => t + x.vendor_price, 0).toFixed(2);
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const phone = `${gt ? "502" : "504"} ${9000_0000 + Math.floor(rand() * 9_999_999)}`;
    out.push({
      id, account_id: acc.id, external_id: String(n - i * 7919), shopify_order: String(113000 + i), status: st[1], status_code: st[0],
      dropshipper: pick(SELLERS), customer_name: `${pick(FIRST)} ${pick(LAST)}`, customer_email: `cliente${i}@example.com`,
      customer_phone: phone, department: dept, city, address: "Barrio El Centro, casa color verde frente a la pulpería",
      reference_point: rand() < 0.5 ? "Frente a la iglesia" : null, notes: rand() < 0.3 ? "Llamar antes de llegar" : null,
      carrier: rand() < 0.88 ? "Forza" : "Cargo Expreso", tracking_number: `FD${34972132 + i}`, tracking_url: "https://tracking.example.com",
      label_url: "https://example.com/guia.pdf", total, shipping_cost: 89, vendor_amount: vendor, vendor_net: +(vendor * 0.88).toFixed(2),
      cod: true, paid: st[0] === "4" ? rand() < 0.8 : false, currency: acc.currency, ordered_at: at.toISOString(),
      first_seen_at: at.toISOString(), updated_at: at.toISOString(),
      raw: { orderInfo: { statusTimeline: [
        { label: "Orden despachada", occurredAt: new Date(at.getTime() + 0.6 * DAY).toISOString() },
        { label: st[1], occurredAt: new Date(at.getTime() + 2.1 * DAY).toISOString() },
      ] } },
      order_items: items,
    });
  }
  return out;
}

const ORDERS = makeOrders();

const CATALOG: Row[] = [
  ["Klenvas - Urocontrol 60 Capsulas", "38182608", 249.31, 95, "Activo"],
  ["Set de Pelador de Verduras Abridor", "00940184", 276.6, 3, "Activo"],
  ["PRODUCTO EXCLUSIVO DLG", "10954739", 263.22, 99, "Activo"],
  ["CARE:NEL - Crema removedora de manchas", "22955654", 262.15, 3, "Activo"],
  ["MINI FAN", "MINI.FAN", 292.11, 448, "Activo"],
  ["Sovexa Cayenne Pepper Suplemento Botánico para Circulación Saludable 60 Cápsulas", "CAYENNE.PEPPER", 255.73, 62, "Activo"],
  ["Crema Tópica con Biotina 10 en 1", "BIOTINA.10", 239.68, 0, "Activo"],
  ["Chip ECOOBD2 Ahorrador de Combustible", "AHORRADOR.COMBUSTIBLE", 216.68, 99, "Inactivo"],
].map(([name, sku, price, stock, status], i) => ({
  id: `99999999-0000-4000-8000-${String(i).padStart(12, "0")}`, account_id: ACCOUNTS[0].id, external_id: `p${i}`,
  code: `ID-${["Z1GIC", "96CMB", "76BX6", "JYKG0", "DG241", "43149", "EINVS", "N261K"][i]}`, name, sku, status, price,
  suggested_price: null, stock, image_url: null, variants_count: 0, currency: "HNL",
  created_at_platform: new Date(Date.now() - (i * 5 + 2) * DAY).toISOString(), updated_at: new Date().toISOString(), raw: {},
}));

const GROUP: Record<string, string> = {
  registered: "dispatch", pending: "dispatch", fulfilled: "dispatch", "1": "transit", "2": "transit", "3": "transit", "4": "delivered",
  pending_correction: "problem", "6": "problem", "7": "failed", "8": "failed", "5": "cancelled", cancelled: "cancelled", rejected: "cancelled",
};

function withRelations(table: string, r: Row): Row {
  if (table === "orders") {
    const a = ACCOUNTS.find((x) => x.id === r.account_id);
    return { ...r, accounts: a ? { name: a.name, country: a.country, timezone: a.timezone } : null };
  }
  if (table === "accounts") return { ...r, orders: [{ count: ORDERS.filter((o) => o.account_id === r.id).length }] };
  if (table === "products") {
    const a = ACCOUNTS.find((x) => x.id === r.account_id);
    return { ...r, accounts: a ? { name: a.name, timezone: a.timezone } : null };
  }
  return r;
}

class Query {
  private filters: ((r: Row) => boolean)[] = [];
  private sorts: { col: string; asc: boolean }[] = [];
  private from = 0;
  private to = Infinity;
  private one: "maybe" | "single" | null = null;
  private opts: { count?: string; head?: boolean } = {};
  constructor(private table: string) {}
  select(_c?: string, opts?: { count?: string; head?: boolean }) { this.opts = opts ?? {}; return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  in(c: string, v: any[]) { this.filters.push((r) => v.includes(r[c])); return this; }
  gte(c: string, v: any) { this.filters.push((r) => r[c] >= v || Date.parse(r[c]) >= Date.parse(v)); return this; }
  lte(c: string, v: any) { this.filters.push((r) => Date.parse(r[c]) <= Date.parse(v)); return this; }
  or(expr: string) {
    const parts = expr.split(",").map((p) => p.split("."));
    this.filters.push((r) =>
      parts.some(([c, op, ...rest]) => {
        const v = rest.join(".");
        if (op === "ilike") return String(r[c] ?? "").toLowerCase().includes(v.replace(/\*/g, "").toLowerCase());
        if (op === "is") return r[c] === null;
        if (op === "eq") return String(r[c]) === v;
        return false;
      }),
    );
    return this;
  }
  order(col: string, o?: { ascending?: boolean }) { this.sorts.push({ col, asc: o?.ascending ?? true }); return this; }
  range(a: number, b: number) { this.from = a; this.to = b; return this; }
  limit(n: number) { this.to = this.from + n - 1; return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  single() { this.one = "single"; return this; }
  update() { return this; }
  insert() { return this; }
  upsert() { return this; }
  delete() { return this; }
  private run() {
    const src = this.table === "orders" ? ORDERS : this.table === "accounts" ? ACCOUNTS : this.table === "products" ? CATALOG : [];
    let rows = src.filter((r) => this.filters.every((f) => f(r)));
    for (const s of [...this.sorts].reverse()) {
      rows = [...rows].sort((a, b) => (a[s.col] > b[s.col] ? 1 : a[s.col] < b[s.col] ? -1 : 0) * (s.asc ? 1 : -1));
    }
    const count = rows.length;
    const page = rows.slice(this.from, this.to + 1).map((r) => withRelations(this.table, r));
    if (this.opts.head) return { data: null, error: null, count };
    if (this.one) return { data: page[0] ?? null, error: null, count };
    return { data: page, error: null, count };
  }
  then(ok?: (v: any) => any, bad?: (e: any) => any) {
    return Promise.resolve(this.run()).then(ok, bad);
  }
}

function summary(args: Row) {
  const inAcc = (o: Row) => !args.p_account || o.account_id === args.p_account;
  const from = Date.parse(args.p_from), to = Date.parse(args.p_to);
  const base: Row[] = ORDERS.filter(inAcc).map((o) => ({ ...o, grp: GROUP[o.status_code] }));
  const period = base.filter((o) => Date.parse(o.ordered_at) >= from && Date.parse(o.ordered_at) <= to);
  const snapshot: Row = {};
  for (const o of base) snapshot[o.grp] = (snapshot[o.grp] ?? 0) + 1;
  const byCur = new Map<string, Row[]>();
  for (const o of period) byCur.set(o.currency, [...(byCur.get(o.currency) ?? []), o]);
  const sum = (a: Row[], k: string) => +a.reduce((t, o) => t + Number(o[k] ?? 0), 0).toFixed(2);
  const money = [...byCur].map(([currency, a]) => {
    const del = a.filter((o) => o.grp === "delivered");
    return {
      currency, orders: a.length, delivered: del.length, sales: sum(a.filter((o) => o.grp !== "cancelled"), "total"),
      vendor_delivered: sum(del, "vendor_amount"), vendor_paid: sum(del.filter((o) => o.paid), "vendor_amount"),
      vendor_unpaid: sum(del.filter((o) => !o.paid), "vendor_amount"), vendor_net: sum(del, "vendor_net"),
      vendor_in_flight: sum(a.filter((o) => o.grp === "dispatch" || o.grp === "transit"), "vendor_amount"),
    };
  }).sort((a, b) => b.orders - a.orders);
  const unpaidMap = new Map<string, Row[]>();
  for (const o of base.filter((o) => o.grp === "delivered" && !o.paid)) unpaidMap.set(o.currency, [...(unpaidMap.get(o.currency) ?? []), o]);
  const unpaid = [...unpaidMap].map(([currency, a]) => ({ currency, orders: a.length, amount: sum(a, "vendor_amount") }));
  const daily: Row[] = [];
  const hourly = args.p_bucket === "hour";
  const step = hourly ? 3600_000 : DAY;
  const keyOf = (ms: number) => {
    const iso = new Date(ms - 6 * 3600_000).toISOString();
    return hourly ? `${iso.slice(0, 13)}:00` : `${iso.slice(0, 10)}T00:00`;
  };
  for (let t = from; t <= to; t += step) {
    const day = keyOf(t);
    const a = period.filter((o) => keyOf(Date.parse(o.ordered_at)) === day);
    daily.push({ day, orders: a.length, delivered: a.filter((o) => o.grp === "delivered").length, problems: a.filter((o) => o.grp === "problem").length });
  }
  const rank = (key: string) => {
    const m = new Map<string, Row[]>();
    for (const o of period) if (o[key]) m.set(o[key], [...(m.get(o[key]) ?? []), o]);
    return [...m].map(([name, a]) => ({ name, orders: a.length, delivered: a.filter((o) => o.grp === "delivered").length, problems: a.filter((o) => o.grp === "problem").length }))
      .sort((a, b) => b.orders - a.orders).slice(0, 6);
  };
  const pm = new Map<string, Row>();
  for (const o of period.filter((o) => o.grp !== "cancelled")) for (const it of o.order_items) {
    const cur = pm.get(it.product_name) ?? { name: it.product_name, units: 0, orders: 0 };
    cur.units += it.quantity; cur.orders += 1; pm.set(it.product_name, cur);
  }
  return { snapshot, money, unpaid, daily, sellers: rank("dropshipper"), carriers: rank("carrier"), products: [...pm.values()].sort((a, b) => b.units - a.units).slice(0, 6) };
}

function months(args: Row) {
  const m = new Map<string, Row[]>();
  for (const o of ORDERS.filter((o) => !args.p_account || o.account_id === args.p_account)) {
    const key = `${o.ordered_at.slice(0, 7)}-01|${o.account_id}|${o.currency}`;
    m.set(key, [...(m.get(key) ?? []), { ...o, grp: GROUP[o.status_code] }]);
  }
  const sum = (a: Row[], k: string) => +a.reduce((t, o) => t + Number(o[k] ?? 0), 0).toFixed(2);
  return [...m].map(([k, a]) => {
    const [month, acc, currency] = k.split("|");
    const del = a.filter((o) => o.grp === "delivered");
    return {
      month, account_name: ACCOUNTS.find((x) => x.id === acc)?.name, currency, orders: a.length, delivered: del.length,
      problems: a.filter((o) => o.grp === "problem").length, cancelled: a.filter((o) => o.grp === "cancelled").length,
      sales: sum(a.filter((o) => o.grp !== "cancelled"), "total"), vendor_delivered: sum(del, "vendor_amount"),
      vendor_paid: sum(del.filter((o) => o.paid), "vendor_amount"), vendor_unpaid: sum(del.filter((o) => !o.paid), "vendor_amount"),
      vendor_net: sum(del, "vendor_net"),
    };
  }).sort((a, b) => (a.month < b.month ? 1 : -1));
}

export function fixtureClient(): any {
  return {
    from: (t: string) => new Query(t),
    rpc: async (name: string, args: Row) => {
      if (name === "dashboard_summary") return { data: summary(args), error: null };
      if (name === "money_by_month") return { data: months(args), error: null };
      if (name === "product_sales") {
        const out: Row = {};
        for (const o of ORDERS) for (const it of o.order_items) {
          const k = `${o.account_id}:${it.sku ?? it.product_name}`;
          out[k] = { units: (out[k]?.units ?? 0) + it.quantity, orders: (out[k]?.orders ?? 0) + 1 };
        }
        return { data: out, error: null };
      }
      if (name === "order_facets") {
        const a = ORDERS.filter((o) => !args.p_account || o.account_id === args.p_account);
        return { data: { dropshippers: [...new Set(a.map((o) => o.dropshipper))].sort(), carriers: [...new Set(a.map((o) => o.carrier))].sort() }, error: null };
      }
      return { data: null, error: { message: `rpc ${name} no simulado` } };
    },
  };
}
