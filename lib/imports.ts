// Importaciones: estados, catálogos y el costo final por unidad (landed cost). Sin base de
// datos ni Next, para usarlo en servidor, en el navegador y en pruebas. Todo en USD.
import type { RestockOrder, TrackedOrder } from "./inventory.ts";

export const IMPORT_STATUSES = [
  { id: "quote", label: "Cotización", tone: "neutral" },
  { id: "paid", label: "Pagado / anticipo", tone: "accent" },
  { id: "production", label: "En producción", tone: "accent" },
  { id: "ready", label: "Listo para enviar", tone: "accent" },
  { id: "transit", label: "En tránsito", tone: "info" },
  { id: "customs", label: "En aduana", tone: "warning" },
  { id: "released", label: "Liberado", tone: "info" },
  { id: "to_warehouse", label: "En camino a bodega", tone: "info" },
  { id: "received", label: "Recibido", tone: "success" },
  { id: "in_drop", label: "Ingresado en Drop", tone: "success" },
  { id: "closed", label: "Cerrado", tone: "neutral" },
  { id: "cancelled", label: "Cancelada", tone: "danger" },
] as const;

export type ImportStatus = (typeof IMPORT_STATUSES)[number]["id"];
export const isImportStatus = (v: unknown): v is ImportStatus => IMPORT_STATUSES.some((s) => s.id === v);
export const statusInfo = (id: string) => IMPORT_STATUSES.find((s) => s.id === id) ?? IMPORT_STATUSES[0];

/** Ya llegó a la bodega del país (o terminó). */
export const ARRIVED: ImportStatus[] = ["received", "in_drop", "closed"];
export const isActive = (s: string) => !ARRIVED.includes(s as ImportStatus) && s !== "cancelled";
/** Ya se pidió y todavía no entra a Drop: sus productos cuentan como "en camino" en Inventario. */
/** Con guía y todavía sin llegar: se sigue en la paquetera (aunque la importación aún diga "Cotización"). */
export const TRACKED_STATUSES: ImportStatus[] = ["quote", "paid", "production", "ready", "transit", "customs", "released", "to_warehouse"];
export const INBOUND: ImportStatus[] = ["paid", "production", "ready", "transit", "customs", "released", "to_warehouse", "received"];
/** Ya entró a Drop (o se cerró). */
export const IN_DROP: ImportStatus[] = ["in_drop", "closed"];
/** Viajando: si pasan STALE_DAYS sin novedades (cambio de estado o nota), se avisa. */
export const IN_MOTION: ImportStatus[] = ["transit", "customs", "released", "to_warehouse"];
export const STALE_DAYS = 7;

/** Pagada y con la llegada estimada vencida, sin haber llegado. */
export const isLate = (imp: { status: string; eta: string | null }, today: string) =>
  isActive(imp.status) && imp.status !== "quote" && imp.eta !== null && imp.eta < today;

/** Días sin novedades de una importación que viene viajando (null si no corresponde o está al día). */
export function staleDays(imp: { status: string }, lastEventAt: string | null, today: string): number | null {
  if (!IN_MOTION.includes(imp.status as ImportStatus) || !lastEventAt) return null;
  const d = Math.floor((Date.parse(`${today}T23:59:59Z`) - Date.parse(lastEventAt)) / 86_400_000);
  return d >= STALE_DAYS ? d : null;
}

export const TRANSPORTS = [
  { id: "courier", label: "Courier" },
  { id: "air", label: "Aéreo" },
  { id: "sea", label: "Marítimo" },
  { id: "land", label: "Terrestre" },
] as const;
export const transportLabel = (id: string | null) => TRANSPORTS.find((t) => t.id === id)?.label ?? id ?? "—";

/** Paqueteras con página pública de seguimiento ({n} = número de guía). Las demás, por 17TRACK. */
export const CARRIERS: { name: string; url: string }[] = [
  { name: "DHL", url: "https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id={n}" },
  { name: "FedEx", url: "https://www.fedex.com/fedextrack/?trknbr={n}" },
  { name: "UPS", url: "https://www.ups.com/track?loc=es_US&tracknum={n}" },
  { name: "USPS", url: "https://tools.usps.com/go/TrackConfirmAction?tLabels={n}" },
  { name: "Aramex", url: "https://www.aramex.com/us/en/track/results?ShipmentNumber={n}" },
];
const ANY_CARRIER = "https://t.17track.net/es#nums={n}";

/** Enlace de seguimiento: el que se guardó a mano, o el de la paquetera con el número de guía. */
export function trackingUrl(carrier: string | null | undefined, number: string | null | undefined, custom?: string | null): string | null {
  if (custom && /^https?:\/\//i.test(custom.trim())) return custom.trim();
  const n = number?.trim();
  if (!n) return null;
  const c = CARRIERS.find((x) => x.name.toLowerCase() === (carrier ?? "").trim().toLowerCase());
  return (c?.url ?? ANY_CARRIER).replace("{n}", encodeURIComponent(n));
}

export const COST_KINDS = [
  { id: "shipping", label: "Envío", hint: "Flete o courier hasta el país" },
  { id: "import", label: "Importación", hint: "Aranceles, impuestos, agente aduanal, almacenaje en aduana" },
  { id: "other", label: "Adicional", hint: "Inspección, etiquetado, empaque… con el nombre que quieras" },
] as const;
export type CostKind = (typeof COST_KINDS)[number]["id"];
export const isCostKind = (v: unknown): v is CostKind => COST_KINDS.some((k) => k.id === v);
export const costKindLabel = (id: string) => COST_KINDS.find((k) => k.id === id)?.label ?? id;

export const ALLOCATIONS = [
  { id: "value", label: "Por valor", hint: "Según lo que cuesta cada producto (lo normal para impuestos)" },
  { id: "units", label: "Por unidades", hint: "Igual por cada unidad (lo normal para el flete)" },
  { id: "weight", label: "Por peso", hint: "Según el peso de cada producto" },
  { id: "item", label: "A un producto", hint: "Todo el costo a un solo producto" },
] as const;
export type Allocation = (typeof ALLOCATIONS)[number]["id"];
export const isAllocation = (v: unknown): v is Allocation => ALLOCATIONS.some((a) => a.id === v);
export const allocationLabel = (id: string) => ALLOCATIONS.find((a) => a.id === id)?.label ?? id;

export const PAYMENT_METHODS = ["Alibaba", "Transferencia", "Tarjeta", "PayPal", "Alipay", "Western Union", "Efectivo", "Otro"] as const;

export const DOC_KINDS = [
  { id: "proforma", label: "Proforma invoice" },
  { id: "invoice", label: "Factura comercial" },
  { id: "payment", label: "Comprobante de pago" },
  { id: "tracking", label: "Guía (AWB / BL)" },
  { id: "packing", label: "Packing list" },
  { id: "customs", label: "Aduana (DUA / póliza)" },
  { id: "photo", label: "Foto" },
  { id: "other", label: "Otro" },
] as const;
export type DocKind = (typeof DOC_KINDS)[number]["id"];
export const isDocKind = (v: unknown): v is DocKind => DOC_KINDS.some((k) => k.id === v);
export const docKindLabel = (id: string) => DOC_KINDS.find((k) => k.id === id)?.label ?? id;
/** Documentos con montos: solo los ve quien tiene permiso de Dinero. */
export const MONEY_DOCS: DocKind[] = ["proforma", "invoice", "payment"];

/** Tipos de evento del historial: los de actividad y montos no cuentan como novedad del envío. */
export type EventKind = "status" | "tracking" | "activity" | "money";
export const isNews = (kind: string | null | undefined) => !kind || kind === "status" || kind === "tracking";

/** Archivos que se pueden adjuntar: PDF, fotos y planillas (igual que el bucket import-files). */
export const IMPORT_FILE_TYPES: Record<string, { ext: string; photo: boolean }> = {
  "application/pdf": { ext: "pdf", photo: false },
  "image/jpeg": { ext: "jpg", photo: true },
  "image/png": { ext: "png", photo: true },
  "image/webp": { ext: "webp", photo: true },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: "xlsx", photo: false },
};
export const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;
export const IMPORT_FILE_ACCEPT = Object.keys(IMPORT_FILE_TYPES).join(",");

/** Tipo del archivo (o por la extensión, si el navegador no lo informa). */
export function importFileType(type: string, filename: string): string | null {
  const t = type.toLowerCase();
  if (IMPORT_FILE_TYPES[t]) return t;
  const ext = filename.toLowerCase().split(".").pop();
  const byExt: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  return !t || t === "application/octet-stream" ? (ext && byExt[ext]) || null : null;
}

export function importFileProblem(type: string, filename: string, size: number, photoOnly = false): string | null {
  const t = importFileType(type, filename);
  if (!t || (photoOnly && !IMPORT_FILE_TYPES[t].photo)) return photoOnly ? "La foto debe ser JPG, PNG o WEBP." : "Solo PDF, fotos (JPG, PNG, WEBP) o Excel (.xlsx).";
  if (!(size > 0)) return "El archivo está vacío.";
  if (size > MAX_IMPORT_FILE_BYTES) return "El archivo pesa más de 25 MB.";
  return null;
}

/** Ruta que el servidor le da a un archivo de una importación ("<id>/<carpeta>/<uuid>.<ext>"). */
export const isImportFilePath = (path: string, importId: string, folder: "docs" | "items") =>
  new RegExp(`^${importId}/${folder}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(pdf|jpg|png|webp|xlsx)$`).test(path);

// ─── Costo final por unidad ───

export type CostItem = {
  id: string; qty: number; unit_cost: number; unit_weight_kg?: number | null;
  /** lo que se contó al recibir (null: todavía no se cuenta) y lo que llegó dañado */
  received_qty?: number | null; damaged_qty?: number | null;
};
export type CostLine = { id?: string; kind: CostKind; amount: number; allocation: Allocation; item_id?: string | null };

export type ItemCost = {
  id: string;
  qty: number;
  /** unidades buenas: las recibidas sin daño o, si no se contó, las pedidas */
  good: number;
  product: number; // costo de los productos de la línea (qty × unit_cost)
  shipping: number;
  import: number;
  other: number;
  total: number;
  /** costo final por unidad buena */
  unit: number;
  /** desglose por unidad */
  unitParts: { product: number; shipping: number; import: number; other: number };
};

export type Landed = {
  items: ItemCost[];
  totals: { product: number; shipping: number; import: number; other: number; total: number; units: number; good: number };
  /** costos que no se pudieron repartir como se pidió (p. ej. por peso sin pesos) */
  notes: string[];
};

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

/** Se contó al recibir. */
export const counted = (i: { received_qty?: number | null }) => i.received_qty !== null && i.received_qty !== undefined;
/** Unidades buenas: las recibidas sin daño o, mientras no se cuente, las pedidas. */
export const goodUnits = (i: { qty: number; received_qty?: number | null; damaged_qty?: number | null }) =>
  counted(i) ? Math.max(0, n(i.received_qty) - n(i.damaged_qty)) : n(i.qty);

/** Pesos de reparto de una línea de costo; si no hay base (todo en cero), se reparte por unidades. */
function weights(items: CostItem[], c: CostLine): { w: number[]; fellBack: boolean } {
  const by = (f: (i: CostItem) => number) => items.map(f);
  if (c.allocation === "item") return { w: by((i) => (i.id === c.item_id ? 1 : 0)), fellBack: false };
  const base =
    c.allocation === "value" ? by((i) => n(i.qty) * n(i.unit_cost))
      : c.allocation === "weight" ? by((i) => n(i.qty) * n(i.unit_weight_kg))
        : by((i) => n(i.qty));
  if (base.some((x) => x > 0)) return { w: base, fellBack: false };
  return { w: by((i) => n(i.qty)), fellBack: c.allocation !== "units" };
}

export function landedCosts(items: CostItem[], costs: CostLine[]): Landed {
  const rows: ItemCost[] = items.map((i) => {
    const product = n(i.qty) * n(i.unit_cost);
    return { id: i.id, qty: n(i.qty), good: goodUnits(i), product, shipping: 0, import: 0, other: 0, total: product, unit: 0, unitParts: { product: n(i.unit_cost), shipping: 0, import: 0, other: 0 } };
  });
  const notes: string[] = [];
  for (const line of costs) {
    let c = line;
    const amount = n(c.amount);
    if (!amount || !rows.length) continue;
    if (c.allocation === "item" && !rows.some((r) => r.id === c.item_id)) {
      notes.push("Un costo asignado a un producto que ya no está se repartió por valor.");
      c = { ...c, allocation: "value" };
    }
    const { w, fellBack } = weights(items, c);
    if (fellBack) notes.push(c.allocation === "weight" ? "Faltan pesos: los costos por peso se repartieron por unidades." : "Sin precios cargados: los costos por valor se repartieron por unidades.");
    const sum = w.reduce((t, x) => t + x, 0);
    rows.forEach((r, k) => {
      const share = sum > 0 ? (amount * w[k]) / sum : 0;
      r[c.kind] += share;
      r.total += share;
    });
  }
  // los costos se reparten sobre lo pedido (se pagó y se envió todo); el costo por unidad, sobre
  // las unidades buenas: lo que faltó o llegó dañado lo pagan las que sí se pueden vender
  for (const r of rows) {
    if (r.good <= 0 && r.qty > 0) notes.push("Un producto no tiene unidades buenas: su costo es pérdida y se muestra sobre lo pedido.");
    const q = r.good > 0 ? r.good : r.qty > 0 ? r.qty : 1;
    r.unit = r.total / q;
    r.unitParts = { product: r.product / q, shipping: r.shipping / q, import: r.import / q, other: r.other / q };
  }
  const sum = (k: "product" | "shipping" | "import" | "other" | "total" | "qty" | "good") => rows.reduce((t, r) => t + r[k], 0);
  return {
    items: rows,
    totals: { product: sum("product"), shipping: sum("shipping"), import: sum("import"), other: sum("other"), total: sum("total"), units: sum("qty"), good: sum("good") },
    notes: [...new Set(notes)],
  };
}

/** Margen bajo: menos de este porcentaje sobre el precio de venta. */
export const LOW_MARGIN = 0.2;

/** Margen por unidad frente al precio de venta (USD). null sin precio. */
export function marginOf(unitCost: number, salePrice: number | null | undefined, qty: number) {
  if (!salePrice || salePrice <= 0) return null;
  const unit = salePrice - unitCost;
  return { unit, pct: unit / salePrice, total: unit * qty, low: unit / salePrice < LOW_MARGIN, breakEven: Math.ceil((unitCost * qty) / salePrice) };
}

/** Qué parte de las unidades hay que vender para recuperar lo invertido (0–1, o más si no alcanza). */
export function recoveryShare(totalCost: number, revenue: number): number | null {
  return revenue > 0 ? totalCost / revenue : null;
}

/** Siguiente código del año: IMP-2026-001, IMP-2026-002… */
export function nextCode(year: number, existing: string[]): string {
  const prefix = `IMP-${year}-`;
  const max = existing.filter((c) => c.startsWith(prefix)).map((c) => Number(c.slice(prefix.length)) || 0).reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

/** Hay que avisar a la bodega: no se reportó, sigue en camino y llega en `days` días o menos (o ya pasó). */
export function needsReport(imp: { status: string; reported_at: string | null; eta: string | null }, today: string, days = 3): boolean {
  if (imp.reported_at || !isActive(imp.status) || !imp.eta) return false;
  const diff = (Date.parse(imp.eta) - Date.parse(today)) / 86_400_000;
  return diff <= days;
}

/** Mensaje para avisar a la bodega por WhatsApp. */
export function whatsappMessage(imp: {
  code: string; dest_country: string; carrier: string | null; tracking_number: string | null; eta: string | null; supplier?: string | null;
}, items: { name: string; sku: string | null; qty: number }[], countryName: (c: string) => string, link: string | null): string {
  const units = items.reduce((t, i) => t + i.qty, 0);
  const lines = [
    `Hola, les avisamos de una importación que llega a ${countryName(imp.dest_country)}:`,
    `*${imp.code}*${imp.supplier ? ` · ${imp.supplier}` : ""}`,
    ...(imp.carrier || imp.tracking_number ? [`Guía: ${[imp.carrier, imp.tracking_number].filter(Boolean).join(" ")}`] : []),
    ...(link ? [`Seguimiento: ${link}`] : []),
    ...(imp.eta ? [`Llegada estimada: ${imp.eta.split("-").reverse().join("/")}`] : []),
    "",
    `Productos (${units.toLocaleString("en-US")} u.):`,
    ...items.map((i) => `• ${i.qty.toLocaleString("en-US")} × ${i.name}${i.sku ? ` (SKU ${i.sku})` : ""}`),
    "",
    "Por favor confirmen cuando llegue y cuántas unidades recibieron. ¡Gracias!",
  ];
  return lines.join("\n");
}

// ─── Recepción ───

/** Lo que se contó al recibir: unidades recibidas, dañadas, faltantes y sobrantes. */
export function receptionSummary(items: { qty: number; received_qty?: number | null; damaged_qty?: number | null }[]) {
  const done = items.filter(counted);
  const total = (f: (i: (typeof items)[number]) => number, list = done) => list.reduce((t, i) => t + f(i), 0);
  return {
    /** todas las líneas contadas */
    complete: items.length > 0 && done.length === items.length,
    started: done.length > 0,
    lines: done.length,
    ordered: total((i) => n(i.qty), items),
    received: total((i) => n(i.received_qty)),
    damaged: total((i) => n(i.damaged_qty)),
    missing: total((i) => Math.max(0, n(i.qty) - n(i.received_qty))),
    extra: total((i) => Math.max(0, n(i.received_qty) - n(i.qty))),
    good: total((i) => goodUnits(i), items),
  };
}

// ─── Inventario: lo que viene en importaciones ───

/** Una entrada de Drop cierra una línea de importación si trae al menos esta parte de lo esperado. */
export const DROP_MATCH_SHARE = 0.5;

export type SupplyImport = {
  id: string; code: string; supplier: string | null; status: string;
  ordered_at: string | null; created_at: string; eta: string | null; arrived_at: string | null; updated_at?: string | null;
};
export type SupplyItem = {
  id: string; import_id: string; account_id: string | null; product_external_id: string | null;
  qty: number; received_qty?: number | null; damaged_qty?: number | null;
};

/**
 * Líneas de importación como pedidos de reposición: cuentan desde que se paga hasta que entran a
 * Drop. Solo las enlazadas a un producto de Drop (las nuevas, cuando se enlazan).
 */
export function importOrders(imports: SupplyImport[], items: SupplyItem[]): RestockOrder[] {
  const byId = new Map(imports.map((i) => [i.id, i]));
  // fechas sin hora (YYYY-MM-DD): a mediodía UTC, para que no caigan el día anterior en Centroamérica
  const at = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00Z` : d);
  return items.flatMap((it): RestockOrder[] => {
    const imp = byId.get(it.import_id);
    if (!imp || !it.account_id || !it.product_external_id) return [];
    const declared = IN_DROP.includes(imp.status as ImportStatus);
    if (!declared && !INBOUND.includes(imp.status as ImportStatus)) return [];
    const units = goodUnits(it);
    if (units <= 0) return [];
    return [{
      id: `imp:${it.id}`,
      account_id: it.account_id,
      product_external_id: it.product_external_id,
      units,
      ordered_at: at(imp.ordered_at ?? imp.created_at),
      eta: imp.eta,
      note: `${imp.code}${imp.supplier ? ` · ${imp.supplier}` : ""}`,
      cancelled_at: null,
      import: { id: imp.id, code: imp.code, item_id: it.id, declared_at: declared ? at(imp.arrived_at ?? imp.updated_at ?? imp.ordered_at ?? imp.created_at) : null },
      min_units: Math.ceil(units * DROP_MATCH_SHARE),
    }];
  });
}

/** Cómo va cada línea respecto de Drop. */
export type DropState =
  | { kind: "in"; at: string; units: number; seen: boolean } // entró (seen: se vio la entrada en Drop)
  | { kind: "coming"; late: boolean } // pagada y en camino
  | { kind: "unlinked" } // producto nuevo, todavía no está en Drop
  | { kind: "waiting" }; // cotización o cancelada: no cuenta

export function dropState(item: SupplyItem, tracked: TrackedOrder | undefined): DropState {
  if (!item.account_id || !item.product_external_id) return { kind: "unlinked" };
  if (!tracked) return { kind: "waiting" };
  if (tracked.status === "arrived") {
    const seen = !tracked.import?.declared_at || tracked.arrived_at !== tracked.import.declared_at;
    return { kind: "in", at: tracked.arrived_at!, units: tracked.arrived_units ?? tracked.units, seen };
  }
  return { kind: "coming", late: tracked.status === "late" };
}

/** Todas las líneas enlazadas entraron a Drop (vistas en sus movimientos) y no queda ninguna sin enlazar. */
export function allInDrop(items: SupplyItem[], states: Map<string, DropState>): { done: boolean; at: string | null; units: number } {
  if (!items.length) return { done: false, at: null, units: 0 };
  let at: string | null = null;
  let units = 0;
  for (const i of items) {
    const st = states.get(i.id);
    if (st?.kind !== "in" || !st.seen) return { done: false, at: null, units: 0 };
    if (!at || st.at > at) at = st.at;
    units += st.units;
  }
  return { done: true, at, units };
}

// ─── Productos nuevos: enlazar cuando aparecen en Drop ───

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** El producto de Drop que corresponde a una línea nueva: por SKU (o código) y, si no, por nombre exacto. Solo si hay uno. */
export function matchNewProduct<P extends { name: string; sku: string | null; code?: string | null }>(item: { name: string; sku: string | null }, products: P[]): P | null {
  const sku = item.sku?.trim().toLowerCase();
  if (sku) {
    const hits = products.filter((p) => [p.sku, p.code].some((v) => v && v.trim().toLowerCase() === sku));
    if (hits.length) return hits.length === 1 ? hits[0] : null;
  }
  const name = norm(item.name);
  if (name.length < 6) return null; // nombres muy cortos ("Taza") se confunden: solo por SKU
  const hits = products.filter((p) => norm(p.name) === name);
  return hits.length === 1 ? hits[0] : null;
}

// ─── Resumen diario ───

export type DigestImport = {
  id: string; code: string; supplier: string | null; dest_country: string; status: string; eta: string | null; reported_at: string | null; units: number;
  /** última novedad (para avisar si viaja sin novedades); opcional */
  last_event_at?: string | null;
};

/** Para el correo diario: importaciones atrasadas, las que llegan esta semana y las que faltan avisar a la bodega. */
export function importsDigest(imports: DigestImport[], today: string) {
  const days = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const active = imports.filter((i) => isActive(i.status) && i.status !== "quote").sort((a, b) => (a.eta ?? "9999").localeCompare(b.eta ?? "9999"));
  return {
    late: active.filter((i) => i.eta && days(i.eta) < 0),
    week: active.filter((i) => i.eta && days(i.eta) >= 0 && days(i.eta) <= 7),
    unreported: active.filter((i) => needsReport(i, today)),
    stale: active.filter((i) => staleDays(i, i.last_event_at ?? null, today) !== null).map((i) => ({ ...i, days: staleDays(i, i.last_event_at ?? null, today)! })),
  };
}
