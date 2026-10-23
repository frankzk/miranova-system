// Compras › Laboratorios: compras locales a laboratorios (en quetzales) y cómo se reparten las
// unidades entre las cuentas. Sin base de datos ni Next: sirve en servidor, cliente y pruebas.

export const LAB_STATUSES = [
  { id: "requested", label: "Solicitado", tone: "neutral" },
  { id: "in_progress", label: "En proceso", tone: "warning" },
  { id: "transit", label: "En tránsito", tone: "info" },
  { id: "arrived", label: "Llegó a bodega", tone: "success" },
] as const;
export type LabStatus = (typeof LAB_STATUSES)[number]["id"];
export const isLabStatus = (v: unknown): v is LabStatus => LAB_STATUSES.some((s) => s.id === v);
export const labStatus = (id: string) => LAB_STATUSES.find((s) => s.id === id) ?? LAB_STATUSES[0];

/** A dónde se reparten las unidades, en el orden de la planilla. */
export const LAB_DESTINATIONS = [
  { id: "miranova_gt", label: "Miranova GT" },
  { id: "miranova_hn", label: "Miranova HN" },
  { id: "mireva_hn", label: "Mireva HN" },
  { id: "miranova_sv", label: "Miranova SV" },
  { id: "miranova_cr", label: "Miranova CR" },
  { id: "mireva_cr", label: "Mireva CR" },
  { id: "dropi_gt", label: "Dropi GT" },
  { id: "dropi_cr", label: "Dropi CR" },
] as const;
export type LabDestination = (typeof LAB_DESTINATIONS)[number]["id"];
export type Distribution = Partial<Record<LabDestination, number>>;

export type LabPurchase = {
  id: string;
  product: string;
  /** Laboratorio que lo fabrica o vende (opcional). */
  lab_name: string | null;
  status: LabStatus;
  /** Fechas "YYYY-MM-DD": solicitud, traslado y llegada a Drop. */
  requested_at: string;
  shipped_at: string | null;
  arrived_at: string | null;
  boxes: number | null;
  qty_requested: number;
  qty_courtesy: number;
  distribution: Distribution;
  /** Precio por unidad en quetzales (solo con permiso de Dinero). */
  unit_price_gtq: number | null;
  /** Quetzales por dólar con que se pasa el monto a USD. */
  fx_gtq_per_usd: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type LabFields = Omit<LabPurchase, "id" | "created_by" | "created_at" | "updated_at">;

/** Cuentas que salen de la fila: lo que llega, lo repartido y los montos. */
export function labTotals(r: Pick<LabPurchase, "qty_requested" | "qty_courtesy" | "distribution" | "unit_price_gtq" | "fx_gtq_per_usd">) {
  const total = r.qty_requested + r.qty_courtesy;
  const distributed = LAB_DESTINATIONS.reduce((t, d) => t + (r.distribution[d.id] ?? 0), 0);
  // la cortesía no se cobra: el monto es por lo solicitado
  const amount_gtq = r.unit_price_gtq === null ? null : round2(r.unit_price_gtq * r.qty_requested);
  const amount_usd = amount_gtq === null || !r.fx_gtq_per_usd ? null : round2(amount_gtq / r.fx_gtq_per_usd);
  return { total, distributed, pending: total - distributed, amount_gtq, amount_usd };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "YYYY-MM-DD" que existe en el calendario. */
export function isDay(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toISOString().slice(0, 10) === s;
}

const MAX_QTY = 10_000_000;

type Input = {
  product?: string; lab_name?: string; status?: string; requested_at?: string; shipped_at?: string; arrived_at?: string;
  boxes?: string; qty_requested?: string; qty_courtesy?: string; distribution?: Partial<Record<string, string>>;
  unit_price_gtq?: string; fx_gtq_per_usd?: string; notes?: string;
};

/**
 * Valida el formulario. Cantidades enteras ("1,500" vale), precio y tipo de cambio con decimales.
 * La fecha de solicitud vacía es `today`; traslado y llegada no pueden ser anteriores. Si queda
 * "Llegó a bodega" sin fecha de llegada, se toma hoy. No se puede repartir más de lo que llega.
 * Con `money = false` no se leen precio ni tipo de cambio (quedan en null: quien guarda decide no tocarlos).
 */
export function cleanLabPurchase(input: Input, today: string, money: boolean): { ok: true; row: LabFields } | { ok: false; msg: string } {
  const text = (v: string | undefined, max: number) => (v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  const int = (v: string | undefined): number | null | "bad" => {
    const raw = (v ?? "").trim().replace(/[,\s]/g, "");
    if (!raw) return null;
    if (!/^\d+$/.test(raw) || Number(raw) > MAX_QTY) return "bad";
    return Number(raw);
  };
  const dec = (v: string | undefined): number | null | "bad" => {
    const raw = (v ?? "").trim().replace(/[\s,]/g, "").replace(/^Q/i, "");
    if (!raw) return null;
    if (!/^\d+(\.\d+)?$/.test(raw)) return "bad";
    return Number(raw);
  };

  const product = text(input.product, 160);
  if (!product) return { ok: false, msg: "Escribe el nombre del producto." };
  const status = (input.status ?? "").trim() || "requested";
  if (!isLabStatus(status)) return { ok: false, msg: "Estado no válido." };

  const qty_requested = int(input.qty_requested);
  if (qty_requested === "bad" || !qty_requested) return { ok: false, msg: "La cantidad solicitada debe ser un número entero mayor que cero." };
  const qty_courtesy = int(input.qty_courtesy);
  if (qty_courtesy === "bad") return { ok: false, msg: "La cortesía debe ser un número entero (0 si no hay)." };
  const boxes = int(input.boxes);
  if (boxes === "bad") return { ok: false, msg: "El número de cajas debe ser un entero." };

  const distribution: Distribution = {};
  for (const d of LAB_DESTINATIONS) {
    const n = int(input.distribution?.[d.id]);
    if (n === "bad") return { ok: false, msg: `La cantidad de ${d.label} debe ser un número entero.` };
    if (n) distribution[d.id] = n;
  }

  const requested_at = (input.requested_at ?? "").trim() || today;
  if (!isDay(requested_at)) return { ok: false, msg: "La fecha de solicitud no es válida." };
  if (requested_at > today) return { ok: false, msg: "La fecha de solicitud no puede ser futura." };
  const shipped_at = (input.shipped_at ?? "").trim() || null;
  if (shipped_at && !isDay(shipped_at)) return { ok: false, msg: "La fecha de traslado no es válida." };
  if (shipped_at && shipped_at < requested_at) return { ok: false, msg: "La fecha de traslado no puede ser anterior a la solicitud." };
  let arrived_at = (input.arrived_at ?? "").trim() || null;
  if (arrived_at && !isDay(arrived_at)) return { ok: false, msg: "La fecha de llegada a Drop no es válida." };
  if (arrived_at && arrived_at < (shipped_at ?? requested_at)) {
    return { ok: false, msg: `La fecha de llegada a Drop no puede ser anterior ${shipped_at ? "al traslado" : "a la solicitud"}.` };
  }
  if (status === "arrived" && !arrived_at) arrived_at = today < requested_at ? requested_at : today;

  let unit_price_gtq: number | null = null;
  let fx_gtq_per_usd: number | null = null;
  if (money) {
    const p = dec(input.unit_price_gtq);
    if (p === "bad") return { ok: false, msg: "El precio por unidad debe ser un número, p. ej. 12.50." };
    const fx = dec(input.fx_gtq_per_usd);
    if (fx === "bad" || fx === 0) return { ok: false, msg: "El tipo de cambio debe ser un número mayor que cero, p. ej. 7.65." };
    unit_price_gtq = p;
    fx_gtq_per_usd = fx;
  }

  const total = qty_requested + (qty_courtesy ?? 0);
  const distributed = Object.values(distribution).reduce((t, n) => t + (n ?? 0), 0);
  if (distributed > total) {
    return { ok: false, msg: `Se reparten ${distributed.toLocaleString("en-US")} unidades y solo llegan ${total.toLocaleString("en-US")} (solicitada + cortesía).` };
  }

  return {
    ok: true,
    row: {
      product, lab_name: text(input.lab_name, 120) || null, status, requested_at, shipped_at, arrived_at, boxes, qty_requested,
      qty_courtesy: qty_courtesy ?? 0, distribution, unit_price_gtq, fx_gtq_per_usd, notes: (input.notes ?? "").trim().slice(0, 2000) || null,
    },
  };
}

/** Pestañas de la lista. */
export const LAB_VIEWS = [
  { id: "activas", label: "En curso", statuses: ["requested", "in_progress", "transit"] },
  { id: "llegaron", label: "Llegaron a bodega", statuses: ["arrived"] },
  { id: "todas", label: "Todas", statuses: null },
] as const satisfies readonly { id: string; label: string; statuses: readonly LabStatus[] | null }[];
export type LabView = (typeof LAB_VIEWS)[number];
export const inLabView = (r: Pick<LabPurchase, "status">, v: LabView) => v.statuses === null || (v.statuses as readonly string[]).includes(r.status);

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
/** Búsqueda por producto, laboratorio o notas. */
export function matchesLab(r: Pick<LabPurchase, "product" | "lab_name" | "notes">, q: string | undefined): boolean {
  const needle = norm(q ?? "");
  return !needle || [r.product, r.lab_name, r.notes].some((v) => v && norm(v).includes(needle));
}

/** Lee la distribución guardada (jsonb) sin confiar en su forma. */
export function parseDistribution(v: unknown): Distribution {
  const out: Distribution = {};
  if (!v || typeof v !== "object") return out;
  for (const d of LAB_DESTINATIONS) {
    const n = Number((v as Record<string, unknown>)[d.id]);
    if (Number.isInteger(n) && n > 0) out[d.id] = n;
  }
  return out;
}
