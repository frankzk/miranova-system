import "server-only";
import type { TrackInfo } from "./tracking17";
import { dhlNumber, parseDhlResponse } from "./tracking-dhl";

// Llamada a la API oficial de seguimiento de DHL (Shipment Tracking - Unified). La clave va en el
// encabezado DHL-API-Key. El plan gratuito permite 250 consultas al día y una cada 5 segundos.
// Con los datos simulados (MIRANOVA_FIXTURES=1) responde con un ejemplo fijo, sin salir a internet.

const BASE = "https://api-eu.dhl.com/track/shipments";
/** espera entre consultas seguidas (el plan gratuito permite una cada 5 s) */
export const DHL_GAP_MS = process.env.MIRANOVA_FIXTURES === "1" ? 0 : 5_500;

export type DhlResult = { found: true; info: TrackInfo } | { found: false; message: string };

/** Estado de una guía en DHL. Lanza error si la clave no sirve o se pasó el límite (vale para todas las guías). */
export async function dhlTrack(number: string, key: string): Promise<DhlResult> {
  const n = dhlNumber(number);
  let status: number;
  let json: unknown;
  if (process.env.MIRANOVA_FIXTURES === "1") {
    ({ status, json } = fake(n, key));
  } else {
    const res = await fetch(`${BASE}?${new URLSearchParams({ trackingNumber: n, language: "es" })}`, {
      headers: { "DHL-API-Key": key, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    status = res.status;
    json = await res.json().catch(() => null);
  }
  if (status === 401 || status === 403) throw new Error("DHL rechazó la clave: revísala en Ajustes → Integraciones (API Key de la app con “Shipment Tracking - Unified”).");
  if (status === 429) throw new Error("DHL: se alcanzó el límite de consultas del plan (250 al día). Se vuelve a intentar en la próxima revisión.");
  if (status === 404) return { found: false, message: "DHL todavía no tiene información de esta guía." };
  if (status < 200 || status >= 300) {
    const detail = json && typeof json === "object" ? String((json as { detail?: unknown; title?: unknown }).detail ?? (json as { title?: unknown }).title ?? "") : "";
    throw new Error(`DHL respondió ${status}${detail ? `: ${detail}` : ""}.`);
  }
  const info = parseDhlResponse(json, number);
  return info ? { found: true, info } : { found: false, message: "DHL todavía no tiene información de esta guía." };
}

/** Ejemplo para pruebas locales: en tránsito con dos novedades; las que terminan en 0000, entregadas; BAD…, no existe. */
const T0 = Date.now(); // horas fijas, como las de una paquetera de verdad
function fake(n: string, key: string): { status: number; json: unknown } {
  if (/^bad/i.test(key)) return { status: 401, json: { status: 401, title: "Unauthorized" } };
  if (n.startsWith("BAD")) return { status: 404, json: { status: 404, title: "No result found", detail: "No shipment with given tracking number found." } };
  const h = 3_600_000;
  const at = (hoursAgo: number) => new Date(T0 - hoursAgo * h).toISOString();
  const delivered = n.endsWith("0000");
  const events = delivered
    ? [
        { timestamp: at(4), location: { address: { addressLocality: "TEGUCIGALPA - HONDURAS" } }, statusCode: "delivered", description: "Entregado - Firmado por: BOXFUL" },
        { timestamp: at(28), location: { address: { addressLocality: "TEGUCIGALPA - HONDURAS" } }, statusCode: "transit", description: "Con el mensajero de entrega" },
      ]
    : [
        { timestamp: at(5), location: { address: { addressLocality: "CINCINNATI HUB - USA" } }, statusCode: "transit", description: "Salió de la instalación de DHL" },
        { timestamp: at(30), location: { address: { addressLocality: "HONG KONG - HONG KONG" } }, statusCode: "transit", description: "Procesado en HONG KONG" },
        { timestamp: at(50), location: { address: { addressLocality: "SHENZHEN - CHINA MAINLAND" } }, statusCode: "pre-transit", description: "Envío recogido" },
      ];
  return {
    status: 200,
    json: {
      shipments: [
        {
          id: n,
          service: "express",
          status: events[0],
          estimatedTimeOfDelivery: delivered ? undefined : new Date(T0 + 72 * h).toISOString().slice(0, 10) + "T23:59:00",
          events,
        },
      ],
    },
  };
}
