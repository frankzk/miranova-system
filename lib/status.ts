// Agrupa los estados de Drop en grupos operativos del proveedor.
// Los códigos numéricos son estados del envío; los textuales, de la orden.

export type StatusGroup = "dispatch" | "transit" | "delivered" | "problem" | "failed" | "cancelled";
export type Tone = "warning" | "info" | "success" | "danger" | "neutral" | "accent";

export const GROUPS: { id: StatusGroup; label: string; codes: string[]; hint: string }[] = [
  {
    id: "dispatch",
    label: "Por despachar",
    codes: ["registered", "pending", "fulfilled", "-1"],
    hint: "Pendientes o con guía creada, aún sin recolectar",
  },
  { id: "transit", label: "En tránsito", codes: ["1", "2", "3", "12"], hint: "Recolectadas, en ruta o en agencia" },
  { id: "delivered", label: "Entregadas", codes: ["4"], hint: "Entregadas al cliente" },
  {
    id: "problem",
    label: "Con problemas",
    codes: ["pending_correction", "6"],
    hint: "Por verificar o con problemas en gestión: requieren acción",
  },
  { id: "failed", label: "No entregadas", codes: ["7", "8"], hint: "No se pudieron entregar" },
  { id: "cancelled", label: "Canceladas", codes: ["5", "cancelled", "rejected"], hint: "Canceladas, rechazadas o con guía cancelada" },
];

export const groupById = (id: string | undefined) => GROUPS.find((g) => g.id === id);

export function groupOf(code: string | null | undefined): StatusGroup | null {
  if (!code) return null;
  return GROUPS.find((g) => g.codes.includes(code))?.id ?? null;
}

const TONE_BY_CODE: Record<string, Tone> = {
  registered: "warning",
  pending: "warning",
  fulfilled: "accent",
  "-1": "accent",
  pending_correction: "warning",
  "12": "info",
  "1": "info",
  "2": "info",
  "3": "info",
  "4": "success",
  "5": "neutral",
  "6": "danger",
  "7": "danger",
  "8": "danger",
  cancelled: "neutral",
  rejected: "neutral",
};

/** Tono visual del estado; si no hay código, se infiere del texto. */
export function toneOf(code: string | null | undefined, label?: string | null): Tone {
  if (code && TONE_BY_CODE[code]) return TONE_BY_CODE[code];
  const t = (label ?? "").toLowerCase();
  if (/entregad/.test(t) && !/no entregad/.test(t)) return "success";
  if (/no entregad|problema|devuel/.test(t)) return "danger";
  if (/ruta|recolect|tránsito|transito/.test(t)) return "info";
  if (/cancel|rechaz/.test(t)) return "neutral";
  if (/pendiente|verificar/.test(t)) return "warning";
  return "neutral";
}
