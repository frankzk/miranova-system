// Importaciones: estados, catálogos y el costo final por unidad (landed cost). Sin base de
// datos ni Next, para usarlo en servidor, en el navegador y en pruebas. Todo en USD.

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
  { id: "units", label: "Por unidades", hint: "Igual por cada unidad" },
  { id: "weight", label: "Por peso", hint: "Según el peso de cada producto (lo normal para el flete)" },
  { id: "item", label: "A un producto", hint: "Todo el costo a un solo producto" },
] as const;
export type Allocation = (typeof ALLOCATIONS)[number]["id"];
export const isAllocation = (v: unknown): v is Allocation => ALLOCATIONS.some((a) => a.id === v);
export const allocationLabel = (id: string) => ALLOCATIONS.find((a) => a.id === id)?.label ?? id;

export const PAYMENT_METHODS = ["Transferencia", "Tarjeta", "PayPal", "Alipay", "Western Union", "Efectivo", "Otro"] as const;

export const DOC_KINDS = [
  { id: "invoice", label: "Factura / proforma" },
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
export const MONEY_DOCS: DocKind[] = ["invoice", "payment"];

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

export type CostItem = { id: string; qty: number; unit_cost: number; unit_weight_kg?: number | null };
export type CostLine = { id?: string; kind: CostKind; amount: number; allocation: Allocation; item_id?: string | null };

export type ItemCost = {
  id: string;
  qty: number;
  product: number; // costo de los productos de la línea (qty × unit_cost)
  shipping: number;
  import: number;
  other: number;
  total: number;
  /** costo final por unidad */
  unit: number;
  /** desglose por unidad */
  unitParts: { product: number; shipping: number; import: number; other: number };
};

export type Landed = {
  items: ItemCost[];
  totals: { product: number; shipping: number; import: number; other: number; total: number; units: number };
  /** costos que no se pudieron repartir como se pidió (p. ej. por peso sin pesos) */
  notes: string[];
};

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

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
    return { id: i.id, qty: n(i.qty), product, shipping: 0, import: 0, other: 0, total: product, unit: 0, unitParts: { product: n(i.unit_cost), shipping: 0, import: 0, other: 0 } };
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
  for (const r of rows) {
    const q = r.qty > 0 ? r.qty : 1;
    r.unit = r.total / q;
    r.unitParts = { product: r.product / q, shipping: r.shipping / q, import: r.import / q, other: r.other / q };
  }
  const sum = (k: "product" | "shipping" | "import" | "other" | "total") => rows.reduce((t, r) => t + r[k], 0);
  return {
    items: rows,
    totals: { product: sum("product"), shipping: sum("shipping"), import: sum("import"), other: sum("other"), total: sum("total"), units: rows.reduce((t, r) => t + r.qty, 0) },
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
