// UPS (Tracking API oficial, developer.ups.com): leer la respuesta de GET /api/track/v1/details.
// Puro, para probarlo; la llamada de red está en lib/tracking-ups-client.ts. Se traduce a los mismos
// estados que 17TRACK, como DHL.

import { arr, cleanNumber, obj, str, ymd, type Obj } from "./track-json.ts";
import type { TrackEvent, TrackInfo } from "./tracking17.ts";

/** La guía es de UPS. */
export const isUps = (carrier: string | null | undefined) => /\bups\b/i.test(carrier ?? "");

const OUT_FOR_DELIVERY = /out for delivery|en ruta|en reparto/i;
const PICKUP = /access point|ready for pick ?up|available for pick ?up|lista para retir/i;
const DELIVERY_PROBLEM = /deliver|entrega/i;

/** Tipo de estado de UPS (D, I, X, P, M, O…) en los nombres de 17TRACK. */
export function upsStatus(type: string | null, text: string | null): string {
  switch ((type ?? "").toUpperCase()) {
    case "D":
      return "Delivered";
    case "O":
      return "OutForDelivery";
    case "X":
      return text && DELIVERY_PROBLEM.test(text) ? "DeliveryFailure" : "Exception";
    case "RS":
      return "Exception";
    case "M":
    case "MV":
      return "InfoReceived";
    case "":
      return "NotFound";
    default:
      if (text && OUT_FOR_DELIVERY.test(text)) return "OutForDelivery";
      if (text && PICKUP.test(text)) return "AvailableForPickup";
      return "InTransit";
  }
}

/** Fecha y hora de una actividad: la de GMT si viene; si no, la local (como si fuera UTC). */
function when(a: Obj): string | null {
  const gd = str(a.gmtDate);
  const gt = str(a.gmtTime);
  if (gd && /^\d{8}$/.test(gd)) {
    const t = gt && /^\d{2}:\d{2}(:\d{2})?$/.test(gt) ? (gt.length === 5 ? `${gt}:00` : gt) : "00:00:00";
    return `${gd.slice(0, 4)}-${gd.slice(4, 6)}-${gd.slice(6, 8)}T${t}Z`;
  }
  const d = str(a.date);
  const t = str(a.time);
  if (d && /^\d{8}$/.test(d)) {
    const hh = t && /^\d{6}$/.test(t) ? `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}` : "00:00:00";
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${hh}Z`;
  }
  return null;
}

function place(v: unknown): string | null {
  const a = obj(obj(v)?.address);
  if (!a) return null;
  const parts = [str(a.city), str(a.stateProvince), str(a.countryCode) ?? str(a.country)].filter(Boolean) as string[];
  return parts.length ? parts.join(", ") : null;
}

function activity(v: unknown): (TrackEvent & { type: string | null }) | null {
  const a = obj(v);
  if (!a) return null;
  const status = obj(a.status);
  const text = str(status?.description);
  const at = when(a);
  if (!text || !at || Number.isNaN(Date.parse(at))) return null;
  return { text, location: place(a.location), at: new Date(at).toISOString(), type: str(status?.type) };
}

export type UpsParsed = { found: true; info: TrackInfo } | { found: false; message: string };

/** La respuesta de /api/track/v1/details/{guía}. */
export function parseUpsResponse(json: unknown, number: string): UpsParsed {
  const want = cleanNumber(number);
  const shipment = obj(arr(obj(obj(json)?.trackResponse)?.shipment)[0]);
  const packages = arr(shipment?.package).map(obj).filter((x): x is Obj => Boolean(x));
  const pkg = packages.find((p) => str(p.trackingNumber) && cleanNumber(str(p.trackingNumber)!) === want) ?? packages[0];
  if (!pkg) {
    const warn = str(obj(arr(shipment?.warnings)[0])?.message);
    return { found: false, message: warn && !/not found/i.test(warn) ? `UPS: ${warn}` : "UPS todavía no tiene información de esta guía." };
  }
  const acts = arr(pkg.activity).map(activity).filter((e): e is TrackEvent & { type: string | null } => Boolean(e)).sort((a, b) => b.at.localeCompare(a.at));
  const current = obj(pkg.currentStatus);
  const type = str(current?.type) ?? acts[0]?.type ?? null;
  const text = str(current?.description) ?? acts[0]?.text ?? null;
  const status = upsStatus(type, text);
  const dates = arr(pkg.deliveryDate).map(obj);
  const scheduled = dates.find((d) => ["RDD", "SDD", "EDD"].includes((str(d?.type) ?? "").toUpperCase())) ?? null;
  const strip = (e: (TrackEvent & { type: string | null }) | undefined): TrackEvent | null => (e ? { text: e.text, location: e.location, at: e.at } : null);
  return {
    found: true,
    info: {
      number,
      status,
      subStatus: type,
      latest: strip(acts[0]),
      eta: status === "Delivered" ? null : ymd(scheduled?.date),
      events: acts.map((e) => strip(e)!),
    },
  };
}
