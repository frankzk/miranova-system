import { type Connector, type LoginResult, type Session, PlatformError, SessionExpired } from "./types.ts";

// Conector para Boxful (app.goboxful.com), solo para las liquidaciones de Mireva (no baja pedidos).
// Su API vive en api-web.goboxful.com (tomado del JavaScript público de la web):
//   POST /auth/client  { email, password }  → token del cliente (Bearer)
//   GET  /settlement/client?begin=<ISO>&end=<ISO>  → liquidaciones del cliente (encontrada con la sesión iniciada)

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

export const boxful: Connector & {
  fetchSettlements(session: Session, begin: Date, end: Date): Promise<{ url: string; status: number; payload: unknown; text: string }>;
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

  // Liquidaciones del cliente en un rango de fechas (la web pide begin/end en ISO 8601): solo lectura.
  async fetchSettlements(session, begin, end) {
    const url = `${API}/settlement/client?${new URLSearchParams({ begin: begin.toISOString(), end: end.toISOString() })}`;
    const res = await fetch(url, { headers: auth(session), cache: "no-store" });
    if (res.status === 401) throw new SessionExpired();
    const { json, text } = await readJson(res);
    if (!res.ok || json === null) throw new PlatformError(errorMessage(json, text, res.status));
    return { url, status: res.status, payload: json, text };
  },
};
