// DHL (API oficial "Shipment Tracking - Unified", developer.dhl.com): leer la respuesta de
// GET /track/shipments. Puro, para probarlo; la llamada de red está en lib/tracking-dhl-client.ts.
// Se lee con cuidado (todo opcional) y se traduce a los mismos estados que 17TRACK, así el resto
// del panel (historial, avisos, llegada estimada) funciona igual con cualquiera de los dos.

import type { TrackEvent, TrackInfo } from "./tracking17.ts";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** La guía es de DHL (DHL, DHL Express, DHL eCommerce…). */
export const isDhl = (carrier: string | null | undefined) => /\bdhl\b/i.test(carrier ?? "");

/** Quita espacios y guiones: así la escriben a veces en las facturas. */
export const dhlNumber = (n: string) => n.replace(/[\s-]+/g, "").toUpperCase();

const OUT_FOR_DELIVERY = /out for delivery|with delivery courier|en reparto|con el mensajero|en ruta de entrega/i;
const PICKUP = /available for pick ?up|ready for pick ?up|awaiting collection|lista para retir|disponible para retir/i;
const DELIVERY_PROBLEM = /deliver|entrega/i;

/** El estado de DHL (pre-transit, transit, delivered, failure, unknown) en los nombres de 17TRACK. */
export function dhlStatus(code: string | null, text: string | null): string {
  switch ((code ?? "").toLowerCase()) {
    case "delivered":
      return "Delivered";
    case "failure":
      return text && DELIVERY_PROBLEM.test(text) ? "DeliveryFailure" : "Exception";
    case "pre-transit":
      return "InfoReceived";
    case "transit":
      if (text && OUT_FOR_DELIVERY.test(text)) return "OutForDelivery";
      if (text && PICKUP.test(text)) return "AvailableForPickup";
      return "InTransit";
    default:
      return "NotFound";
  }
}

function location(v: unknown): string | null {
  const a = obj(obj(v)?.address);
  if (!a) return null;
  const parts = [str(a.addressLocality), str(a.countryCode)].filter(Boolean) as string[];
  return parts.length ? parts.join(", ") : null;
}

function event(v: unknown): (TrackEvent & { code: string | null }) | null {
  const e = obj(v);
  if (!e) return null;
  const text = str(e.description) ?? str(e.status) ?? str(e.remark);
  const ts = str(e.timestamp);
  if (!text || !ts || Number.isNaN(Date.parse(ts))) return null;
  return { text, location: location(e.location), at: new Date(ts).toISOString(), code: str(e.statusCode) };
}

/** "2026-10-15T23:59:00" → "2026-10-15" (la fecha tal como la da DHL, sin moverla de zona). */
function day(v: unknown): string | null {
  const s = str(v);
  const m = s ? /^(\d{4}-\d{2}-\d{2})/.exec(s) : null;
  return m ? m[1] : null;
}

/** La respuesta de /track/shipments para una guía. Null si no trae ningún envío. */
export function parseDhlResponse(json: unknown, number: string): TrackInfo | null {
  const shipments = arr(obj(json)?.shipments).map(obj).filter((s): s is Obj => Boolean(s));
  if (!shipments.length) return null;
  const want = dhlNumber(number);
  const s = shipments.find((x) => str(x.id) && dhlNumber(str(x.id)!) === want) ?? shipments[0];
  const events = arr(s.events)
    .map(event)
    .filter((e): e is TrackEvent & { code: string | null } => Boolean(e))
    .sort((a, b) => b.at.localeCompare(a.at));
  const current = event(s.status) ?? events[0] ?? null;
  const code = str(obj(s.status)?.statusCode) ?? current?.code ?? null;
  const frame = obj(s.estimatedDeliveryTimeFrame);
  const strip = (e: (TrackEvent & { code: string | null }) | null): TrackEvent | null => (e ? { text: e.text, location: e.location, at: e.at } : null);
  return {
    number,
    status: dhlStatus(code, current?.text ?? null),
    subStatus: code,
    latest: strip(current),
    eta: code === "delivered" ? null : day(s.estimatedTimeOfDelivery) ?? day(frame?.estimatedThrough) ?? day(frame?.estimatedFrom),
    events: events.map(strip).filter((e): e is TrackEvent => Boolean(e)),
  };
}
