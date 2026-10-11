import "server-only";
import { parseRegisterResponse, parseTrackResponse } from "./tracking17";

// Llamadas a la API v2.2 de 17TRACK (la clave va en el encabezado 17token). Con los datos
// simulados (MIRANOVA_FIXTURES=1) responde con un ejemplo fijo, sin salir a internet.

const BASE = "https://api.17track.net/track/v2.2";
const MAX_PER_CALL = 40;

async function call(path: "register" | "gettrackinfo", numbers: string[], key: string): Promise<unknown> {
  if (process.env.MIRANOVA_FIXTURES === "1") return fake(path, numbers);
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "17token": key, "Content-Type": "application/json" },
    body: JSON.stringify(numbers.map((number) => ({ number }))),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => null)) as { code?: number; data?: { errors?: { message?: string }[] } } | null;
  if (res.status === 401 || res.status === 403) throw new Error("17TRACK rechazó la clave: revísala en Ajustes → Integraciones.");
  if (!res.ok || !json) throw new Error(`17TRACK respondió ${res.status}.`);
  if (json.code !== 0) throw new Error(`17TRACK: ${json.data?.errors?.[0]?.message ?? `código ${json.code}`}`);
  return json;
}

export async function registerNumbers(numbers: string[], key: string) {
  const out = { ok: [] as string[], failed: [] as { number: string; message: string }[] };
  for (let i = 0; i < numbers.length; i += MAX_PER_CALL) {
    const r = parseRegisterResponse(await call("register", numbers.slice(i, i + MAX_PER_CALL), key));
    out.ok.push(...r.ok);
    out.failed.push(...r.failed);
  }
  return out;
}

export async function trackNumbers(numbers: string[], key: string) {
  const out: ReturnType<typeof parseTrackResponse> = { accepted: [], rejected: [] };
  for (let i = 0; i < numbers.length; i += MAX_PER_CALL) {
    const r = parseTrackResponse(await call("gettrackinfo", numbers.slice(i, i + MAX_PER_CALL), key));
    out.accepted.push(...r.accepted);
    out.rejected.push(...r.rejected);
  }
  return out;
}

/** Ejemplo para pruebas locales: una guía en tránsito con dos novedades; las que terminan en 0000, entregadas. */
const T0 = Date.now(); // horas fijas, como las de una paquetera de verdad
function fake(path: string, numbers: string[]) {
  if (path === "register") return { code: 0, data: { accepted: numbers.map((number) => ({ number, carrier: 100001 })), rejected: [] } };
  const h = 3_600_000;
  const at = (hoursAgo: number) => new Date(T0 - hoursAgo * h).toISOString();
  const eta = new Date(T0 + 48 * h).toISOString();
  return {
    code: 0,
    data: {
      accepted: numbers.filter((n) => !n.startsWith("BAD")).map((number) => {
        const delivered = number.endsWith("0000");
        const events = delivered
          ? [{ time_utc: at(5), description: "Delivered - Signed for by BOXFUL", location: "TEGUCIGALPA, HN" }, { time_utc: at(30), description: "With delivery courier", location: "TEGUCIGALPA, HN" }]
          : [{ time_utc: at(6), description: "Departed Facility in HONG KONG", location: "HONG KONG, HK" }, { time_utc: at(40), description: "Shipment picked up", location: "SHENZHEN, CN" }];
        return {
          number,
          track_info: {
            latest_status: { status: delivered ? "Delivered" : "InTransit", sub_status: null },
            latest_event: events[0],
            time_metrics: { estimated_delivery_date: delivered ? null : { from: eta, to: eta } },
            tracking: { providers: [{ provider: { name: "DHL" }, events }] },
          },
        };
      }),
      rejected: numbers.filter((n) => n.startsWith("BAD")).map((number) => ({ number, error: { message: "No tracking information at this time." } })),
    },
  };
}
