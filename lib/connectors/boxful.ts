import { type Connector, type LoginResult, type ProbeAttempt, type Session, PlatformError, SessionExpired } from "./types.ts";

// Conector para Boxful (app.goboxful.com), solo para las liquidaciones de Mireva (no baja pedidos).
// Su API vive en api-web.goboxful.com (tomado del JavaScript público de la web):
//   POST /auth/client  { email, password }  → token del cliente (Bearer)
// La ruta de liquidaciones no es pública: se busca con la sesión iniciada (solo lectura) y se guarda
// el diagnóstico en la cuenta para terminar la lectura con la forma real de la respuesta.

const API = process.env.BOXFUL_API_URL ?? "https://api-web.goboxful.com";

const BASE_HEADERS: Record<string, string> = {
  accept: "application/json, text/plain, */*",
  "content-type": "application/json",
  "x-frontend-source": "Boxful-FE-Platform-2024",
  origin: "https://app.goboxful.com",
  referer: "https://app.goboxful.com/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function findKey(node: unknown, test: (k: string) => boolean, depth = 0): string | undefined {
  if (!isObj(node) || depth > 4) return undefined;
  for (const [k, v] of Object.entries(node)) if (test(k) && (typeof v === "string" || typeof v === "number") && String(v)) return String(v);
  for (const v of Object.values(node)) {
    const r = findKey(v, test, depth + 1);
    if (r) return r;
  }
  return undefined;
}

async function readJson(res: Response): Promise<{ json: unknown; text: string }> {
  const text = await res.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

function errorMessage(json: unknown, text: string, status: number): string {
  const msg = findKey(json, (k) => /^(message|error|detail|msg)$/i.test(k));
  return `Boxful respondió ${status}: ${msg ?? text.slice(0, 200)}`;
}

/** Datos del token (sin verificar la firma): de ahí sale el id del cliente. */
export function jwtClaims(token: string | undefined): Obj {
  try {
    const payload = JSON.parse(Buffer.from(token!.split(".")[1], "base64url").toString("utf8"));
    return isObj(payload) ? payload : {};
  } catch {
    return {};
  }
}

/** El id del cliente de Boxful: en la respuesta del login o en el token. */
export function clientIdOf(json: unknown, token: string | undefined): string | undefined {
  const fromBody = findKey(json, (k) => /^(client_?id|clientId)$/i.test(k)) ?? (isObj(json) && isObj(json.client) ? findKey(json.client, (k) => /^(id|_id)$/.test(k)) : undefined);
  if (fromBody) return fromBody;
  const c = jwtClaims(token);
  for (const k of ["clientId", "client_id", "client", "id", "sub"]) {
    const v = c[k];
    if (typeof v === "string" || typeof v === "number") return String(v);
    if (isObj(v) && (typeof v.id === "string" || typeof v.id === "number")) return String(v.id);
  }
  return undefined;
}

const auth = (s: Session): Record<string, string> => ({ ...BASE_HEADERS, ...(s.token ? { authorization: `Bearer ${s.token}` } : {}) });

const onlySettlements = () => {
  throw new PlatformError("Boxful se conecta solo para las liquidaciones de Conciliación: no baja pedidos.");
};

/** Rutas candidatas de liquidaciones; con el id del cliente, también las de /client/:id. */
export function settlementCandidates(clientId: string | undefined, from: string, to: string): string[] {
  const range = `startDate=${from}&endDate=${to}`;
  const base = [
    "/settlement", "/settlements", "/settlement/client", "/settlements/client", "/client-settlement", "/client-settlements",
    "/settlement/list", "/settlements/list", "/settlement/history", "/settlements/history", "/liquidation", "/liquidations",
    `/settlement?page=1&limit=10&${range}`, `/settlements?page=1&limit=10&${range}`,
  ];
  if (!clientId) return base;
  const id = encodeURIComponent(clientId);
  return [
    ...base,
    `/client/${id}/settlements`, `/client/${id}/settlement`, `/settlement/client/${id}`, `/settlements/client/${id}`,
    `/settlement/by-client/${id}`, `/settlement?clientId=${id}`, `/settlements?clientId=${id}`,
    `/settlement/client/${id}?page=1&limit=10&${range}`, `/client/${id}/settlements?page=1&limit=10&${range}`,
  ];
}

export const boxful: Connector & {
  probeSettlements(session: Session): Promise<{ clientId: string | null; claimKeys: string[]; attempts: ProbeAttempt[] }>;
} = {
  async login(email, password): Promise<LoginResult> {
    const res = await fetch(`${API}/auth/client`, {
      method: "POST",
      headers: BASE_HEADERS,
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
    const { json, text } = await readJson(res);
    if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
      throw new PlatformError(`Correo o contraseña incorrectos (${errorMessage(json, text, res.status)})`);
    }
    if (!res.ok) throw new PlatformError(errorMessage(json, text, res.status));
    const token =
      findKey(json, (k) => /^access_?token$/i.test(k)) ??
      findKey(json, (k) => /^(token|jwt|id_?token)$/i.test(k)) ??
      findKey(json, (k) => /token/i.test(k) && !/refresh/i.test(k));
    if (!token) throw new PlatformError(`Boxful no devolvió token: ${text.slice(0, 200)}`);
    const id = clientIdOf(json, token) ?? "cliente";
    const name = findKey(json, (k) => /^(businessName|companyName|commercialName|name)$/i.test(k)) ?? "Boxful";
    return { identity: token, accounts: [{ ref: id, name }] };
  },

  async selectAccount(login): Promise<Session> {
    return { token: login.identity, obtainedAt: Date.now() };
  },

  async discoverOrdersPath() {
    return onlySettlements();
  },

  async fetchOrders() {
    return onlySettlements();
  },

  // Solo lectura: qué responde cada ruta candidata (las que contestan bien, con una muestra para ver su forma).
  async probeSettlements(session) {
    const claims = jwtClaims(session.token);
    const clientId = clientIdOf(null, session.token) ?? null;
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const to = new Date();
    const from = new Date(to.getTime() - 120 * 86_400_000);
    const attempts: ProbeAttempt[] = [];
    for (const path of settlementCandidates(clientId ?? undefined, day(from), day(to))) {
      try {
        const res = await fetch(`${API}${path}`, { headers: auth(session), cache: "no-store" });
        if (res.status === 401) throw new SessionExpired();
        const { text } = await readJson(res);
        attempts.push({ path, status: res.status, orders: 0, sample: text.slice(0, res.ok ? 3000 : 300) });
      } catch (e) {
        if (e instanceof SessionExpired) throw e;
        attempts.push({ path, status: -1, orders: 0, sample: String(e).slice(0, 300) });
      }
    }
    return { clientId, claimKeys: Object.keys(claims), attempts };
  },
};
