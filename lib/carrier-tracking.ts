import "server-only";
import { integrationKey } from "./integrations";
import type { TrackInfo } from "./tracking17";
import { isDhl } from "./tracking-dhl";
import { DHL_GAP_MS, dhlTrack } from "./tracking-dhl-client";
import { isFedex } from "./tracking-fedex";
import { fedexClient } from "./tracking-fedex-client";
import { isUps } from "./tracking-ups";
import { upsClient } from "./tracking-ups-client";

// Seguimiento con las APIs oficiales (gratuitas) de DHL, FedEx y UPS; para cualquier otra paquetera,
// 17TRACK. Cada guía va con la API de su paquetera si hay clave; si no, con 17TRACK (si hay).

export type CarrierResult = { found: true; info: TrackInfo } | { found: false; message: string };
export type Carrier = "dhl" | "fedex" | "ups";
export type Provider = Carrier | "track17";
export const CARRIERS_OFFICIAL: Carrier[] = ["dhl", "fedex", "ups"];
export const PROVIDER_LABEL: Record<Provider, string> = { dhl: "DHL", fedex: "FedEx", ups: "UPS", track17: "17TRACK" };

/** La paquetera de una guía según cómo se escribió ("DHL Express", "Fedex", "UPS"…). */
export function carrierOf(name: string | null | undefined): Carrier | null {
  if (isDhl(name)) return "dhl";
  if (isFedex(name)) return "fedex";
  if (isUps(name)) return "ups";
  return null;
}

type Pair = { id: string; secret: string };
export type TrackingKeys = { dhl: string | null; fedex: Pair | null; ups: Pair | null; track17: string | null };
export type Available = Record<Provider, boolean>;

export async function trackingKeys(): Promise<TrackingKeys> {
  const [dhl, fedexId, fedexSecret, upsId, upsSecret, track17] = await Promise.all(
    (["dhl", "fedex_id", "fedex_secret", "ups_id", "ups_secret", "track17"] as const).map((n) => integrationKey(n)),
  );
  return {
    dhl,
    fedex: fedexId && fedexSecret ? { id: fedexId, secret: fedexSecret } : null,
    ups: upsId && upsSecret ? { id: upsId, secret: upsSecret } : null,
    track17,
  };
}

export const available = (k: TrackingKeys): Available => ({ dhl: !!k.dhl, fedex: !!k.fedex, ups: !!k.ups, track17: !!k.track17 });

/** Quién sigue esta guía: la API de su paquetera (si hay clave) o 17TRACK. */
export function trackingProvider(carrier: string | null, has: Available): Provider | null {
  const c = carrierOf(carrier);
  if (c && has[c]) return c;
  return has.track17 ? "track17" : null;
}

/** Cliente de una paquetera para una vuelta (FedEx y UPS piden el token una sola vez). */
export function carrierTracker(c: Carrier, keys: TrackingKeys): { track: (n: string) => Promise<CarrierResult>; gapMs: number } {
  if (c === "dhl") return { track: (n) => dhlTrack(n, keys.dhl!), gapMs: DHL_GAP_MS };
  if (c === "fedex") return { ...fedexClient(keys.fedex!.id, keys.fedex!.secret), gapMs: 0 };
  return { ...upsClient(keys.ups!.id, keys.ups!.secret), gapMs: 0 };
}
