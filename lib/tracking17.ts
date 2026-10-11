// 17TRACK (API v2.2): leer la respuesta de gettrackinfo y register. Puro, para probarlo; la
// llamada de red está en lib/tracking17-client.ts. La respuesta se lee con cuidado (todo opcional)
// porque la plataforma puede agregar o mover campos.

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const TRACK_STATUS: Record<string, { label: string; tone: string }> = {
  NotFound: { label: "Sin información todavía", tone: "neutral" },
  InfoReceived: { label: "Guía creada", tone: "neutral" },
  InTransit: { label: "En tránsito", tone: "info" },
  Expired: { label: "Sin movimiento", tone: "warning" },
  AvailableForPickup: { label: "Lista para retirar", tone: "accent" },
  OutForDelivery: { label: "En reparto", tone: "accent" },
  DeliveryFailure: { label: "Entrega fallida", tone: "danger" },
  Delivered: { label: "Entregada", tone: "success" },
  Exception: { label: "Con problemas", tone: "danger" },
};
export const trackStatusInfo = (s: string | null) => (s && TRACK_STATUS[s]) || { label: s ?? "—", tone: "neutral" };
/** Requiere atención: la paquetera reporta un problema. */
export const trackAlert = (s: string | null) => s === "Exception" || s === "DeliveryFailure" || s === "Expired";

export type TrackEvent = { text: string; location: string | null; at: string };
export type TrackInfo = {
  number: string;
  status: string | null;
  subStatus: string | null;
  latest: TrackEvent | null;
  /** llegada que estima la paquetera (YYYY-MM-DD) */
  eta: string | null;
  /** novedades, de la más reciente a la más vieja */
  events: TrackEvent[];
};

function event(v: unknown): TrackEvent | null {
  const e = obj(v);
  if (!e) return null;
  const text = str(e.description) ?? str(e.description_translation && obj(e.description_translation)?.description);
  const at = str(e.time_utc) ?? str(e.time_iso);
  if (!text || !at || Number.isNaN(Date.parse(at))) return null;
  const address = obj(e.address);
  const location = str(e.location) ?? ([address?.city, address?.state, address?.country].map(str).filter(Boolean).join(", ") || null);
  return { text, location, at: new Date(at).toISOString() };
}

/** Una entrada de data.accepted de gettrackinfo. */
export function parseTrackInfo(item: unknown): TrackInfo | null {
  const it = obj(item);
  const number = str(it?.number);
  if (!it || !number) return null;
  const info = obj(it.track_info);
  const latestStatus = obj(info?.latest_status);
  const providers = arr(obj(info?.tracking)?.providers);
  const events = providers
    .flatMap((p) => arr(obj(p)?.events).map(event))
    .filter((e): e is TrackEvent => Boolean(e))
    .sort((a, b) => b.at.localeCompare(a.at));
  const latest = event(info?.latest_event) ?? events[0] ?? null;
  const est = obj(obj(info?.time_metrics)?.estimated_delivery_date);
  const etaRaw = str(est?.to) ?? str(est?.from);
  return {
    number,
    status: str(latestStatus?.status),
    subStatus: str(latestStatus?.sub_status),
    latest,
    eta: etaRaw && !Number.isNaN(Date.parse(etaRaw)) ? new Date(etaRaw).toISOString().slice(0, 10) : null,
    events,
  };
}

/** Respuesta de gettrackinfo: las guías leídas y las rechazadas (con su mensaje). */
export function parseTrackResponse(json: unknown): { accepted: TrackInfo[]; rejected: { number: string; message: string }[] } {
  const data = obj(obj(json)?.data);
  return {
    accepted: arr(data?.accepted).map(parseTrackInfo).filter((x): x is TrackInfo => Boolean(x)),
    rejected: arr(data?.rejected).flatMap((r) => {
      const o = obj(r);
      const number = str(o?.number);
      return number ? [{ number, message: str(obj(o?.error)?.message) ?? "17TRACK no reconoce esta guía" }] : [];
    }),
  };
}

/** Respuesta de register: registrada o ya registrada antes cuenta como lista. */
export function parseRegisterResponse(json: unknown): { ok: string[]; failed: { number: string; message: string }[] } {
  const data = obj(obj(json)?.data);
  const ok = arr(data?.accepted).map((a) => str(obj(a)?.number)).filter((n): n is string => Boolean(n));
  const failed: { number: string; message: string }[] = [];
  for (const r of arr(data?.rejected)) {
    const o = obj(r);
    const number = str(o?.number);
    if (!number) continue;
    const message = str(obj(o?.error)?.message) ?? "No se pudo registrar";
    if (/already|registered|registrad/i.test(message)) ok.push(number);
    else failed.push({ number, message });
  }
  return { ok, failed };
}

/** Novedades que todavía no están en el historial (las posteriores a la última guardada). */
export function newEvents(info: TrackInfo, lastAt: string | null, max = 10): TrackEvent[] {
  if (!lastAt) return info.latest ? [info.latest] : [];
  return info.events.filter((e) => e.at > new Date(lastAt).toISOString()).slice(0, max).reverse();
}
