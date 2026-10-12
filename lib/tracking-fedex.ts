// FedEx (Track API oficial, developer.fedex.com): leer la respuesta de POST /track/v1/trackingnumbers.
// Puro, para probarlo; la llamada de red está en lib/tracking-fedex-client.ts. Se traduce a los
// mismos estados que 17TRACK, como DHL.

import { arr, cleanNumber, obj, str, ymd, type Obj } from "./track-json.ts";
import type { TrackEvent, TrackInfo } from "./tracking17.ts";

/** La guía es de FedEx. */
export const isFedex = (carrier: string | null | undefined) => /\bfed\s?ex\b/i.test(carrier ?? "");

const PICKUP = /ready for pick ?up|available for pick ?up|hold at location|lista para retir/i;

/** Código de estado de FedEx (DL, OD, IT, DE…) en los nombres de 17TRACK. */
export function fedexStatus(code: string | null, text: string | null): string {
  switch ((code ?? "").toUpperCase()) {
    case "DL":
      return "Delivered";
    case "OD":
      return "OutForDelivery";
    case "HL":
    case "HP":
      return "AvailableForPickup";
    case "DE":
      return "DeliveryFailure";
    case "SE":
    case "CA":
    case "RS":
    case "CD":
    case "DY":
      return "Exception";
    case "OC":
    case "IN":
      return "InfoReceived";
    case "":
      return "NotFound";
    default:
      return text && PICKUP.test(text) ? "AvailableForPickup" : "InTransit";
  }
}

function place(v: unknown): string | null {
  const a = obj(v);
  if (!a) return null;
  const parts = [str(a.city), str(a.stateOrProvinceCode), str(a.countryCode)].filter(Boolean) as string[];
  return parts.length ? parts.join(", ") : null;
}

function scan(v: unknown): TrackEvent | null {
  const e = obj(v);
  if (!e) return null;
  const text = str(e.eventDescription) ?? str(e.derivedStatus);
  const ts = str(e.date);
  if (!text || !ts || Number.isNaN(Date.parse(ts))) return null;
  return { text, location: place(e.scanLocation), at: new Date(ts).toISOString() };
}

export type FedexParsed = { found: true; info: TrackInfo } | { found: false; message: string };

/** La respuesta de /track/v1/trackingnumbers para una guía. */
export function parseFedexResponse(json: unknown, number: string): FedexParsed {
  const want = cleanNumber(number);
  const complete = arr(obj(obj(json)?.output)?.completeTrackResults).map(obj).filter((x): x is Obj => Boolean(x));
  const entry = complete.find((c) => str(c.trackingNumber) && cleanNumber(str(c.trackingNumber)!) === want) ?? complete[0];
  const result = obj(arr(entry?.trackResults)[0]);
  if (!result) return { found: false, message: "FedEx todavía no tiene información de esta guía." };
  const err = obj(result.error);
  if (err) return { found: false, message: /not ?found|cannot be found/i.test(str(err.message) ?? str(err.code) ?? "") ? "FedEx todavía no tiene información de esta guía." : `FedEx: ${str(err.message) ?? str(err.code)}` };
  const events = arr(result.scanEvents).map(scan).filter((e): e is TrackEvent => Boolean(e)).sort((a, b) => b.at.localeCompare(a.at));
  const latestDetail = obj(result.latestStatusDetail);
  const code = str(latestDetail?.code) ?? str(latestDetail?.derivedCode);
  const latestText = str(latestDetail?.description) ?? str(latestDetail?.statusByLocale);
  const latest: TrackEvent | null = events[0] ? { ...events[0], location: events[0].location ?? place(latestDetail?.scanLocation) } : null;
  const dates = arr(result.dateAndTimes).map(obj);
  const estimated = dates.find((d) => /estimated_delivery/i.test(str(d?.type) ?? ""));
  const window = obj(obj(result.estimatedDeliveryTimeWindow)?.window);
  const delivered = (code ?? "").toUpperCase() === "DL";
  return {
    found: true,
    info: {
      number,
      status: fedexStatus(code, latestText ?? latest?.text ?? null),
      subStatus: code,
      latest,
      eta: delivered ? null : ymd(estimated?.dateTime) ?? ymd(window?.ends) ?? ymd(window?.begins),
      events,
    },
  };
}
