import "server-only";
import type { CarrierResult } from "./carrier-tracking";
import { cleanNumber } from "./track-json";
import { parseFedexResponse } from "./tracking-fedex";

// Track API oficial de FedEx: primero un token (OAuth, vale 60 min) con la API Key y la Secret Key
// del proyecto, después la consulta. Con los datos simulados responde un ejemplo fijo.

const BASE = "https://apis.fedex.com";
const fixtures = () => process.env.MIRANOVA_FIXTURES === "1";

/** Un cliente por vuelta: pide el token una sola vez. */
export function fedexClient(id: string, secret: string) {
  let token: Promise<string> | null = null;
  const auth = () =>
    (token ??= (async () => {
      if (fixtures()) {
        if (/^bad/i.test(id)) throw new Error("FedEx rechazó las claves: revisa la API Key y la Secret Key en Ajustes → Integraciones.");
        return "token-simulado";
      }
      const res = await fetch(`${BASE}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      const json = (await res.json().catch(() => null)) as { access_token?: string } | null;
      if (res.status === 401 || res.status === 403 || (res.ok && !json?.access_token)) {
        throw new Error("FedEx rechazó las claves: revisa la API Key y la Secret Key en Ajustes → Integraciones (proyecto con Track API).");
      }
      if (!res.ok || !json?.access_token) throw new Error(`FedEx respondió ${res.status} al iniciar sesión.`);
      return json.access_token;
    })());

  return {
    async track(number: string): Promise<CarrierResult> {
      const n = cleanNumber(number);
      const bearer = await auth();
      let status: number;
      let json: unknown;
      if (fixtures()) ({ status, json } = fake(n));
      else {
        const res = await fetch(`${BASE}/track/v1/trackingnumbers`, {
          method: "POST",
          headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
          body: JSON.stringify({ includeDetailedScans: true, trackingInfo: [{ trackingNumberInfo: { trackingNumber: n } }] }),
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        });
        status = res.status;
        json = await res.json().catch(() => null);
      }
      if (status === 401 || status === 403) throw new Error("FedEx rechazó las claves: revisa que el proyecto tenga la Track API.");
      if (status === 429) throw new Error("FedEx: demasiadas consultas seguidas. Se vuelve a intentar en la próxima revisión.");
      if (status === 404) return { found: false, message: "FedEx todavía no tiene información de esta guía." };
      if (status < 200 || status >= 300) {
        const msg = (json as { errors?: { message?: string }[] } | null)?.errors?.[0]?.message;
        throw new Error(`FedEx respondió ${status}${msg ? `: ${msg}` : ""}.`);
      }
      return parseFedexResponse(json, number);
    },
  };
}

/** Ejemplo para pruebas locales: en tránsito; las que terminan en 0000, entregadas; BAD…, no existe. */
const T0 = Date.now();
function fake(n: string): { status: number; json: unknown } {
  const at = (hoursAgo: number) => new Date(T0 - hoursAgo * 3_600_000).toISOString();
  if (n.startsWith("BAD")) {
    return { status: 200, json: { output: { completeTrackResults: [{ trackingNumber: n, trackResults: [{ error: { code: "TRACKING.TRACKINGNUMBER.NOTFOUND", message: "Tracking number cannot be found." } }] }] } } };
  }
  const delivered = n.endsWith("0000");
  const scanEvents = delivered
    ? [{ date: at(3), eventDescription: "Delivered", derivedStatusCode: "DL", scanLocation: { city: "GUATEMALA", countryCode: "GT" } }]
    : [
        { date: at(4), eventDescription: "Departed FedEx hub", derivedStatusCode: "IT", scanLocation: { city: "MEMPHIS", stateOrProvinceCode: "TN", countryCode: "US" } },
        { date: at(40), eventDescription: "Picked up", derivedStatusCode: "PU", scanLocation: { city: "SHENZHEN", countryCode: "CN" } },
      ];
  return {
    status: 200,
    json: {
      output: {
        completeTrackResults: [
          {
            trackingNumber: n,
            trackResults: [
              {
                latestStatusDetail: { code: delivered ? "DL" : "IT", description: delivered ? "Delivered" : "In transit" },
                dateAndTimes: delivered ? [] : [{ type: "ESTIMATED_DELIVERY", dateTime: new Date(T0 + 96 * 3_600_000).toISOString() }],
                scanEvents,
              },
            ],
          },
        ],
      },
    },
  };
}
