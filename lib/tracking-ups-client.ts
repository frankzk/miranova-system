import "server-only";
import { randomUUID } from "node:crypto";
import type { CarrierResult } from "./carrier-tracking";
import { cleanNumber } from "./track-json";
import { parseUpsResponse } from "./tracking-ups";

// Tracking API oficial de UPS: primero un token (OAuth) con el Client ID y el Client Secret de la
// app, después la consulta. Con los datos simulados responde un ejemplo fijo.

const BASE = "https://onlinetools.ups.com";
const fixtures = () => process.env.MIRANOVA_FIXTURES === "1";

/** Un cliente por vuelta: pide el token una sola vez. */
export function upsClient(id: string, secret: string) {
  let token: Promise<string> | null = null;
  const auth = () =>
    (token ??= (async () => {
      if (fixtures()) {
        if (/^bad/i.test(id)) throw new Error("UPS rechazó las claves: revisa el Client ID y el Client Secret en Ajustes → Integraciones.");
        return "token-simulado";
      }
      const res = await fetch(`${BASE}/security/v1/oauth/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ grant_type: "client_credentials" }),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      const json = (await res.json().catch(() => null)) as { access_token?: string } | null;
      if (res.status === 401 || res.status === 403 || (res.ok && !json?.access_token)) {
        throw new Error("UPS rechazó las claves: revisa el Client ID y el Client Secret en Ajustes → Integraciones (app con Tracking API).");
      }
      if (!res.ok || !json?.access_token) throw new Error(`UPS respondió ${res.status} al iniciar sesión.`);
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
        const qs = new URLSearchParams({ locale: "es_US", returnSignature: "false", returnMilestones: "false", returnPOD: "false" });
        const res = await fetch(`${BASE}/api/track/v1/details/${encodeURIComponent(n)}?${qs}`, {
          headers: { Authorization: `Bearer ${bearer}`, transId: randomUUID().replace(/-/g, ""), transactionSrc: "miranova" },
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        });
        status = res.status;
        json = await res.json().catch(() => null);
      }
      if (status === 401 || status === 403) throw new Error("UPS rechazó las claves: revisa que la app tenga la Tracking API.");
      if (status === 429) throw new Error("UPS: demasiadas consultas seguidas. Se vuelve a intentar en la próxima revisión.");
      if (status === 404) return { found: false, message: "UPS todavía no tiene información de esta guía." };
      if (status < 200 || status >= 300) {
        const msg = (json as { response?: { errors?: { message?: string }[] } } | null)?.response?.errors?.[0]?.message;
        throw new Error(`UPS respondió ${status}${msg ? `: ${msg}` : ""}.`);
      }
      return parseUpsResponse(json, number);
    },
  };
}

/** Ejemplo para pruebas locales: en tránsito; las que terminan en 0000, entregadas; BAD…, no existe. */
const T0 = Date.now();
function fake(n: string): { status: number; json: unknown } {
  if (n.startsWith("BAD")) return { status: 404, json: { response: { errors: [{ code: "151044", message: "No tracking information available" }] } } };
  const gmt = (hoursAgo: number) => {
    const d = new Date(T0 - hoursAgo * 3_600_000).toISOString();
    return { gmtDate: d.slice(0, 10).replace(/-/g, ""), gmtTime: d.slice(11, 19) };
  };
  const delivered = n.endsWith("0000");
  const activity = delivered
    ? [{ location: { address: { city: "San Jose", countryCode: "CR" } }, status: { type: "D", description: "Entregado" }, ...gmt(2) }]
    : [
        { location: { address: { city: "Louisville", stateProvince: "KY", countryCode: "US" } }, status: { type: "I", description: "Salió de la instalación" }, ...gmt(6) },
        { location: { address: { city: "Shenzhen", countryCode: "CN" } }, status: { type: "P", description: "Recolección" }, ...gmt(45) },
      ];
  const eta = new Date(T0 + 120 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, "");
  return {
    status: 200,
    json: { trackResponse: { shipment: [{ inquiryNumber: n, package: [{ trackingNumber: n, deliveryDate: delivered ? [{ type: "DEL", date: eta }] : [{ type: "SDD", date: eta }], activity }] }] } },
  };
}
