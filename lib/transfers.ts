// Compras › Traslados: envíos entre bodegas de varios productos juntos (p. ej. de Boxful Guatemala a Honduras),
// con su manifiesto, fechas y lo que llegó a cada bodega de destino. También "Por enviar": lo repartido en
// Solicitudes y Laboratorios a otros países menos lo que ya salió en traslados. Sin base de datos ni Next: sirve en
// servidor, cliente y pruebas.

import { LAB_DESTINATIONS, labStatus, type LabPurchase } from "./lab-purchases.ts";
import { norm, OPEN_STATUSES, requestAllocation, requestItems, requestStatus, type StoreRequest } from "./store-requests.ts";

export const TRANSFER_STATUSES = [
  { id: "preparing", label: "Preparando", tone: "neutral" },
  { id: "transit", label: "En camino", tone: "info" },
  { id: "arrived", label: "Llegó", tone: "success" },
  { id: "cancelled", label: "Cancelado", tone: "danger" },
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number]["id"];
export const isTransferStatus = (v: unknown): v is TransferStatus => TRANSFER_STATUSES.some((s) => s.id === v);
export const transferStatus = (id: string) => TRANSFER_STATUSES.find((s) => s.id === id) ?? TRANSFER_STATUSES[0];

/** Qué es cada producto: importado (llega a Boxful Guatemala) o maquilado (lo fabrica Moi o un laboratorio). */
export const ITEM_KINDS = [
  { id: "import", label: "Importado" },
  { id: "maquila", label: "Maquilado" },
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number]["id"];
export const isItemKind = (v: unknown): v is ItemKind => ITEM_KINDS.some((k) => k.id === v);

/** Qué recibe una bodega como destino. */
export const GOODS = [
  { id: "both", label: "Importados y maquilados" },
  { id: "import", label: "Solo importados" },
  { id: "maquila", label: "Solo maquilados" },
] as const;
export type Goods = (typeof GOODS)[number]["id"];
export const isGoods = (v: unknown): v is Goods => GOODS.some((g) => g.id === v);

/**
 * País donde llega lo importado y se fabrica lo maquilado: lo repartido a este país ya está ahí y no necesita
 * traslado (lo de Moi a Boxful Guatemala es informal y no se registra).
 */
export const HUB_COUNTRY = "GT";

/** A estos países sale todo (también lo maquilado) desde Boxful Guatemala, donde se junta. */
const CONSOLIDATED_COUNTRIES = ["SV"];

export type TransferPoint = {
  id: string;
  code: string;
  name: string;
  country: string;
  city: string | null;
  goods: Goods;
  is_origin: boolean;
  is_destination: boolean;
  /** Cuentas de los repartos de Laboratorios que abastece (miranova_hn…). */
  accounts: string[];
  active: boolean;
  position: number;
};

export type Transfer = {
  id: string;
  code: string;
  origin_id: string;
  dest_country: string;
  carrier: string | null;
  /** N.º de manifiesto o guía. */
  reference: string | null;
  status: TransferStatus;
  shipped_at: string | null;
  eta: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TransferItem = {
  id: string;
  transfer_id: string;
  dest_id: string;
  kind: ItemKind;
  name: string;
  sku: string | null;
  account_id: string | null;
  product_external_id: string | null;
  image_url: string | null;
  qty: number;
  /** De qué reparto sale (ver pendingToSend), o null si se agregó a mano. */
  source: string | null;
  received_qty: number | null;
  damaged_qty: number;
  received_note: string | null;
  position: number;
};

export type TransferArrival = { transfer_id: string; dest_id: string; arrived_at: string; note: string | null; received_by: string | null };

export type TransferFull = Transfer & { items: TransferItem[]; arrivals: TransferArrival[] };

/** TR-2026-001, TR-2026-002… (el siguiente del año). */
export function nextTransferCode(year: number, existing: string[]): string {
  const prefix = `TR-${year}-`;
  const max = existing.filter((c) => c.startsWith(prefix)).map((c) => Number(c.slice(prefix.length)) || 0).reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

/** "YYYY-MM-DD" que existe en el calendario. */
export function isDay(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toISOString().slice(0, 10) === s;
}

/** Cuenta los días entre dos fechas "YYYY-MM-DD" (b − a). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** "2026-11-12" → "12 nov 2026" (para pantalla e historial). */
export function dayLabel(d: string | null): string {
  if (!d || !isDay(d)) return d ?? "—";
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("es-HN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).replace(/\./g, "");
}

// ─── Puntos y rutas ───

/** ¿La bodega recibe esta clase de producto? */
export const accepts = (p: Pick<TransferPoint, "goods">, kind: ItemKind) => p.goods === "both" || p.goods === kind;

/** Bodegas de destino del país para esta clase de producto, en su orden. */
export function destinationsFor(points: readonly TransferPoint[], country: string, kind?: ItemKind): TransferPoint[] {
  return points
    .filter((p) => p.active && p.is_destination && p.country === country && (!kind || accepts(p, kind)))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "es"));
}

/** Bodega de destino que se propone: la primera del país que recibe esa clase de producto. */
export const defaultDest = (points: readonly TransferPoint[], country: string, kind: ItemKind): TransferPoint | null =>
  destinationsFor(points, country, kind)[0] ?? null;

/**
 * Origen que se propone: lo importado sale de Boxful Guatemala; lo maquilado, de la bodega de Moi, salvo a los
 * países donde todo se junta primero en Boxful Guatemala (El Salvador).
 */
export function defaultOrigin(points: readonly TransferPoint[], kind: ItemKind, country: string): TransferPoint | null {
  const origins = points.filter((p) => p.active && p.is_origin && p.country === HUB_COUNTRY).sort((a, b) => a.position - b.position);
  const hub = origins.find((p) => p.goods !== "maquila") ?? origins[0] ?? null;
  if (kind === "import" || CONSOLIDATED_COUNTRIES.includes(country)) return hub;
  return origins.find((p) => p.goods === "maquila") ?? hub;
}

// ─── Lo que llegó ───

/** Merma: lo que no llegó (enviadas − recibidas). null mientras no se cuenta. */
export const shortage = (i: Pick<TransferItem, "qty" | "received_qty">) => (i.received_qty === null ? null : Math.max(0, i.qty - i.received_qty));

/** Unidades buenas: recibidas menos dañadas. */
export const goodUnits = (i: Pick<TransferItem, "received_qty" | "damaged_qty">) => (i.received_qty === null ? null : Math.max(0, i.received_qty - i.damaged_qty));

export type TransferTotals = { lines: number; sent: number; received: number; damaged: number; shortage: number; counted: number };

/** Totales del traslado (o de una bodega): enviadas, recibidas, dañadas y merma de lo ya contado. */
export function totals(items: readonly Pick<TransferItem, "qty" | "received_qty" | "damaged_qty">[]): TransferTotals {
  const t = { lines: items.length, sent: 0, received: 0, damaged: 0, shortage: 0, counted: 0 };
  for (const i of items) {
    t.sent += i.qty;
    if (i.received_qty === null) continue;
    t.counted++;
    t.received += i.received_qty;
    t.damaged += i.damaged_qty;
    t.shortage += shortage(i) ?? 0;
  }
  return t;
}

/** ¿Llegó con diferencias? (merma o dañadas) */
export const hasIssues = (t: Pick<TransferTotals, "damaged" | "shortage">) => t.damaged > 0 || t.shortage > 0;

export type DestGroup = { point: TransferPoint; items: TransferItem[]; arrival: TransferArrival | null; totals: TransferTotals };

/** El traslado por bodega de destino, en el orden de los puntos, con su llegada. */
export function byDestination(t: Pick<TransferFull, "items" | "arrivals">, points: readonly TransferPoint[]): DestGroup[] {
  const pointOf = new Map(points.map((p) => [p.id, p]));
  const groups = new Map<string, TransferItem[]>();
  for (const i of [...t.items].sort((a, b) => a.position - b.position)) groups.set(i.dest_id, [...(groups.get(i.dest_id) ?? []), i]);
  return [...groups.entries()]
    .map(([dest, items]) => ({
      point: pointOf.get(dest) ?? unknownPoint(dest),
      items,
      arrival: t.arrivals.find((a) => a.dest_id === dest) ?? null,
      totals: totals(items),
    }))
    .sort((a, b) => a.point.position - b.point.position || a.point.name.localeCompare(b.point.name, "es"));
}

const unknownPoint = (id: string): TransferPoint => ({
  id, code: "", name: "Bodega borrada", country: "", city: null, goods: "both", is_origin: false, is_destination: true, accounts: [], active: false, position: 9999,
});

/** Estado tras registrar llegadas: llegó cuando cada bodega de destino tiene su llegada. */
export function statusAfterArrivals(t: Pick<TransferFull, "items" | "arrivals" | "status">): TransferStatus {
  if (t.status === "cancelled" || t.status === "preparing") return t.status;
  const dests = new Set(t.items.map((i) => i.dest_id));
  return dests.size > 0 && [...dests].every((d) => t.arrivals.some((a) => a.dest_id === d)) ? "arrived" : "transit";
}

/** En camino y ya pasó la fecha estimada (sin llegar a alguna bodega). */
export const isLate = (t: Pick<Transfer, "status" | "eta">, today: string) => t.status === "transit" && !!t.eta && t.eta < today;

/**
 * Lo contado al llegar a una bodega: un número entero por producto (recibidas) y las dañadas, que no pueden
 * ser más que las recibidas. Vacío no vale: si no llegó nada, es 0.
 */
export function cleanArrival(
  items: readonly Pick<TransferItem, "id" | "name">[],
  input: Record<string, { received?: string; damaged?: string; note?: string }>,
): { ok: true; rows: { id: string; received_qty: number; damaged_qty: number; received_note: string | null }[] } | { ok: false; msg: string } {
  const rows = [];
  for (const i of items) {
    const v = input[i.id] ?? {};
    const rec = (v.received ?? "").replace(/[,\s]/g, "");
    const dmg = (v.damaged ?? "").replace(/[,\s]/g, "") || "0";
    if (!/^\d+$/.test(rec)) return { ok: false, msg: `Escribe cuántas llegaron de “${i.name}” (0 si no llegó ninguna).` };
    if (!/^\d+$/.test(dmg)) return { ok: false, msg: `Revisa las dañadas de “${i.name}”: un número entero.` };
    const received_qty = Number(rec);
    const damaged_qty = Number(dmg);
    if (received_qty > 1_000_000 || damaged_qty > 1_000_000) return { ok: false, msg: `Revisa las cantidades de “${i.name}”.` };
    if (damaged_qty > received_qty) return { ok: false, msg: `${i.name}: no pueden ser más dañadas que recibidas.` };
    rows.push({ id: i.id, received_qty, damaged_qty, received_note: (v.note ?? "").trim().slice(0, 300) || null });
  }
  return { ok: true, rows };
}

// ─── Cuadro: rutas de origen a destino ───

export type RouteRow = {
  origin_id: string;
  dest_id: string;
  preparing: { transfers: number; units: number };
  transit: { transfers: number; units: number; next_eta: string | null; late: number };
  /** Llegadas a esta bodega en los últimos `days` días. */
  arrived: { transfers: number; sent: number; received: number; damaged: number; shortage: number };
};

/** Por cada ruta (origen → bodega de destino): lo que se prepara, lo que va en camino y lo que llegó hace poco. */
export function routeSummary(transfers: readonly TransferFull[], today: string, days = 30): RouteRow[] {
  const rows = new Map<string, RouteRow>();
  const get = (origin_id: string, dest_id: string) => {
    const k = `${origin_id}>${dest_id}`;
    if (!rows.has(k)) {
      rows.set(k, {
        origin_id, dest_id, preparing: { transfers: 0, units: 0 }, transit: { transfers: 0, units: 0, next_eta: null, late: 0 },
        arrived: { transfers: 0, sent: 0, received: 0, damaged: 0, shortage: 0 },
      });
    }
    return rows.get(k)!;
  };
  for (const t of transfers) {
    if (t.status === "cancelled") continue;
    const dests = new Map<string, TransferItem[]>();
    for (const i of t.items) dests.set(i.dest_id, [...(dests.get(i.dest_id) ?? []), i]);
    for (const [dest, items] of dests) {
      const r = get(t.origin_id, dest);
      const sent = items.reduce((s, i) => s + i.qty, 0);
      const arrival = t.arrivals.find((a) => a.dest_id === dest);
      if (t.status === "preparing") {
        r.preparing.transfers++;
        r.preparing.units += sent;
      } else if (!arrival) {
        r.transit.transfers++;
        r.transit.units += sent;
        if (t.eta && (!r.transit.next_eta || t.eta < r.transit.next_eta)) r.transit.next_eta = t.eta;
        if (isLate(t, today)) r.transit.late++;
      } else if (daysBetween(arrival.arrived_at, today) <= days) {
        const tt = totals(items);
        r.arrived.transfers++;
        r.arrived.sent += tt.sent;
        r.arrived.received += tt.received;
        r.arrived.damaged += tt.damaged;
        r.arrived.shortage += tt.shortage;
      }
    }
  }
  return [...rows.values()];
}

// ─── Por enviar ───

export type PendingRow = {
  /** Clave del reparto: "req:<solicitud>:<producto>:<país>" o "lab:<compra>:<cuenta>". */
  source: string;
  kind: ItemKind;
  product: string;
  country: string;
  /** Bodega fija (los repartos de Laboratorios son por cuenta) o null (se elige al armar el traslado). */
  dest_id: string | null;
  allocated: number;
  sent: number;
  pending: number;
  /** De dónde sale: "Solicitud de ZONAHN" o "Laboratorio Maya". */
  from: string;
  /** Estado de la solicitud o de la compra ("Solicitado", "En tránsito"…). */
  state: string;
  date: string;
};

export const requestSource = (requestId: string, product: string, country: string) => `req:${requestId}:${norm(product)}:${country}`;
export const labSource = (labId: string, account: string) => `lab:${labId}:${account}`;

/** "Maya" → "Laboratorio Maya"; "Laboratorios Maya" queda igual. */
export const labName = (name: string | null | undefined) => {
  const n = (name ?? "").trim();
  return !n ? "Laboratorio" : /^laboratorio/i.test(n) ? n : `Laboratorio ${n}`;
};

/**
 * Lo que falta mandar a cada país: lo repartido en las solicitudes abiertas (por país) y en las compras de
 * Laboratorios (por cuenta, que tiene su bodega), menos lo que ya salió en traslados no cancelados con esa misma
 * clave, sin lo que se dio por enviado. Lo repartido a Guatemala ya está ahí: no cuenta.
 */
export function pendingToSend(input: {
  requests: readonly StoreRequest[];
  labs: readonly LabPurchase[];
  points: readonly TransferPoint[];
  /** Unidades ya enviadas por clave (traslados no cancelados). */
  sent: ReadonlyMap<string, number>;
  settled: ReadonlySet<string>;
}): PendingRow[] {
  const out: PendingRow[] = [];
  const add = (row: Omit<PendingRow, "sent" | "pending">) => {
    if (input.settled.has(row.source)) return;
    const sent = input.sent.get(row.source) ?? 0;
    if (row.allocated - sent > 0) out.push({ ...row, sent, pending: row.allocated - sent });
  };
  for (const r of input.requests) {
    if (!(OPEN_STATUSES as readonly string[]).includes(r.status)) continue;
    // el mismo producto escrito dos veces en una solicitud se suma (como en Lo más pedido)
    const merged = new Map<string, { product: string; byCountry: Record<string, number> }>();
    for (const it of requestItems(r)) {
      const k = norm(it.product);
      const m = merged.get(k) ?? { product: it.product, byCountry: {} };
      for (const [c, n] of Object.entries(requestAllocation(it, r.countries))) m.byCountry[c] = (m.byCountry[c] ?? 0) + n;
      merged.set(k, m);
    }
    for (const m of merged.values()) {
      for (const [country, qty] of Object.entries(m.byCountry)) {
        if (country === HUB_COUNTRY || !(qty > 0)) continue;
        add({
          source: requestSource(r.id, m.product, country), kind: "import", product: m.product, country, dest_id: null, allocated: qty,
          from: `Solicitud de ${r.store_name}`, state: requestStatus(r.status).label, date: r.requested_at,
        });
      }
    }
  }
  const validAccount = new Set<string>(LAB_DESTINATIONS.map((d) => d.id));
  for (const l of input.labs) {
    for (const [account, qty] of Object.entries(l.distribution ?? {})) {
      if (!validAccount.has(account) || !(Number(qty) > 0)) continue;
      const point = input.points.find((p) => p.active && p.is_destination && p.accounts.includes(account));
      if (!point || point.country === HUB_COUNTRY) continue;
      add({
        source: labSource(l.id, account), kind: "maquila", product: l.product, country: point.country, dest_id: point.id, allocated: Number(qty),
        from: `${labName(l.lab_name)} · para ${LAB_DESTINATIONS.find((d) => d.id === account)?.label ?? account}`,
        state: labStatus(l.status).label, date: l.requested_at,
      });
    }
  }
  return out.sort((a, b) => a.country.localeCompare(b.country) || a.date.localeCompare(b.date) || a.product.localeCompare(b.product, "es"));
}

/** Unidades enviadas por clave de reparto, sin los traslados cancelados. */
export function sentBySource(transfers: readonly Pick<TransferFull, "status" | "items">[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of transfers) {
    if (t.status === "cancelled") continue;
    for (const i of t.items) if (i.source) out.set(i.source, (out.get(i.source) ?? 0) + i.qty);
  }
  return out;
}

// ─── Formularios ───

const text = (v: string | undefined, max: number) => (v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

/** Datos generales del traslado. Las fechas, si vienen, válidas; la estimada no antes de la salida. */
export function cleanHeader(
  input: { origin_id?: string; dest_country?: string; carrier?: string; reference?: string; shipped_at?: string; eta?: string; notes?: string },
  points: readonly TransferPoint[],
): { ok: true; row: Pick<Transfer, "origin_id" | "dest_country" | "carrier" | "reference" | "shipped_at" | "eta" | "notes"> } | { ok: false; msg: string } {
  const origin = points.find((p) => p.id === input.origin_id && p.is_origin);
  if (!origin) return { ok: false, msg: "Elige de dónde sale." };
  const dest_country = (input.dest_country ?? "").trim().toUpperCase();
  if (!destinationsFor(points, dest_country).some((p) => p.id !== origin.id)) return { ok: false, msg: "Elige a qué país va." };
  const shipped_at = (input.shipped_at ?? "").trim() || null;
  const eta = (input.eta ?? "").trim() || null;
  if (shipped_at && !isDay(shipped_at)) return { ok: false, msg: "Revisa la fecha de salida." };
  if (eta && !isDay(eta)) return { ok: false, msg: "Revisa la fecha estimada de llegada." };
  if (shipped_at && eta && eta < shipped_at) return { ok: false, msg: "La llegada estimada no puede ser antes de la salida." };
  return {
    ok: true,
    row: {
      origin_id: origin.id, dest_country, carrier: text(input.carrier, 60) || null, reference: text(input.reference, 80) || null,
      shipped_at, eta, notes: (input.notes ?? "").trim().slice(0, 2000) || null,
    },
  };
}

/** Un producto del traslado: bodega del país (no la de origen), clase, nombre y cantidad entera. */
export function cleanLine(
  input: { dest_id?: string; kind?: string; name?: string; sku?: string; qty?: string },
  ctx: { points: readonly TransferPoint[]; origin_id: string; country: string },
): { ok: true; row: Pick<TransferItem, "dest_id" | "kind" | "name" | "sku" | "qty"> } | { ok: false; msg: string } {
  const kind = input.kind ?? "import";
  if (!isItemKind(kind)) return { ok: false, msg: "Elige si es importado o maquilado." };
  const name = text(input.name, 200);
  if (!name) return { ok: false, msg: "Escribe o elige el producto." };
  const dest = destinationsFor(ctx.points, ctx.country).find((p) => p.id === input.dest_id);
  if (!dest) return { ok: false, msg: `Elige a qué bodega va “${name}”.` };
  if (dest.id === ctx.origin_id) return { ok: false, msg: "La bodega de destino no puede ser la misma de origen." };
  const raw = (input.qty ?? "").replace(/[,\s]/g, "");
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 1_000_000) return { ok: false, msg: `La cantidad de “${name}” debe ser un número entero mayor que cero.` };
  return { ok: true, row: { dest_id: dest.id, kind, name, sku: text(input.sku, 80) || null, qty: Number(raw) } };
}

/** Datos de una bodega (punto). */
export function cleanPoint(input: {
  name?: string; country?: string; city?: string; goods?: string; is_origin?: boolean; is_destination?: boolean; accounts?: string[]; active?: boolean;
}): { ok: true; row: Pick<TransferPoint, "name" | "country" | "city" | "goods" | "is_origin" | "is_destination" | "accounts" | "active"> } | { ok: false; msg: string } {
  const name = text(input.name, 80);
  if (!name) return { ok: false, msg: "Escribe el nombre de la bodega." };
  const country = (input.country ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return { ok: false, msg: "Elige el país." };
  const goods = input.goods ?? "both";
  if (!isGoods(goods)) return { ok: false, msg: "Elige qué recibe." };
  if (!input.is_origin && !input.is_destination) return { ok: false, msg: "Marca si es origen, destino o los dos." };
  const valid = new Set<string>(LAB_DESTINATIONS.map((d) => d.id));
  return {
    ok: true,
    row: {
      name, country, city: text(input.city, 60) || null, goods, is_origin: !!input.is_origin, is_destination: !!input.is_destination,
      accounts: [...new Set((input.accounts ?? []).filter((a) => valid.has(a)))], active: input.active !== false,
    },
  };
}

/** Código de una bodega nueva a partir de su nombre y país ("bodega_central_hn"), sin repetir. */
export function pointCode(name: string, country: string, existing: readonly string[]): string {
  const base = `${norm(name).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "bodega"}_${country.toLowerCase()}`;
  let code = base;
  for (let n = 2; existing.includes(code); n++) code = `${base}_${n}`;
  return code;
}
