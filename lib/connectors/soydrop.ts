import { extractOrders } from "../normalize.ts";
import {
  type Connector, type LoginResult, type OrdersPage, type PlatformAccount, type ProbeAttempt,
  type Session, PlatformError, SessionExpired,
} from "./types.ts";

// Conector para Drop (app.soydrop.com). Su API privada vive en api.soydrop.com:
//   POST /auth/login            { email, password }       → { identityToken, accounts: [{ ref, name }] }
//   POST /auth/accounts/select  { ref, identityToken }    → sesión de esa cuenta
// (rutas tomadas del JavaScript público de la web de Drop). La ruta de órdenes
// no es pública: se descubre probando candidatas con la sesión iniciada.

const API = process.env.SOYDROP_API_URL ?? "https://api.soydrop.com";
const PAGE_SIZE = 50;

const ORDER_PATH_CANDIDATES = [
  "/vendor/orders",
  "/vendors/orders",
  "/orders/vendor",
  "/vendor/orders/list",
  "/orders/vendor/list",
  "/orders",
  "/v1/vendor/orders",
  "/api/vendor/orders",
];

const BASE_HEADERS: Record<string, string> = {
  accept: "application/json, text/plain, */*",
  "content-type": "application/json",
  origin: "https://app.soydrop.com",
  referer: "https://app.soydrop.com/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Busca recursivamente el primer valor string cuya clave coincida. */
function findKey(node: unknown, test: (k: string) => boolean, depth = 0): string | undefined {
  if (!isObj(node) || depth > 4) return undefined;
  for (const [k, v] of Object.entries(node)) if (test(k) && typeof v === "string" && v) return v;
  for (const v of Object.values(node)) {
    const r = findKey(v, test, depth + 1);
    if (r) return r;
  }
  return undefined;
}

function findArray(node: unknown, test: (k: string) => boolean, depth = 0): unknown[] | undefined {
  if (Array.isArray(node)) return node;
  if (!isObj(node) || depth > 3) return undefined;
  for (const [k, v] of Object.entries(node)) if (test(k) && Array.isArray(v)) return v;
  for (const v of Object.values(node)) {
    const r = findArray(v, test, depth + 1);
    if (r) return r;
  }
  return undefined;
}

function cookiesFrom(res: Response, prev?: string): string | undefined {
  const set = res.headers.getSetCookie?.() ?? [];
  if (!set.length) return prev;
  const jar = new Map<string, string>();
  for (const c of (prev ?? "").split("; ").filter(Boolean)) {
    const i = c.indexOf("=");
    jar.set(c.slice(0, i), c.slice(i + 1));
  }
  for (const c of set) {
    const pair = c.split(";")[0];
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
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
  return `Drop respondió ${status}: ${msg ?? text.slice(0, 200)}`;
}

function authHeaders(s: Session): Record<string, string> {
  const h: Record<string, string> = { ...BASE_HEADERS };
  if (s.token) h.authorization = `Bearer ${s.token}`;
  if (s.cookie) h.cookie = s.cookie;
  return h;
}

export const soydrop: Connector = {
  async login(email, password): Promise<LoginResult> {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: BASE_HEADERS,
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
    const { json, text } = await readJson(res);
    if (res.status === 401 || res.status === 400 || res.status === 403) {
      throw new PlatformError(`Correo o contraseña incorrectos (${errorMessage(json, text, res.status)})`);
    }
    if (!res.ok) throw new PlatformError(errorMessage(json, text, res.status));

    const identity = findKey(json, (k) => /^identity_?token$/i.test(k)) ?? findKey(json, (k) => /token/i.test(k));
    const raw = findArray(json, (k) => /accounts?/i.test(k)) ?? [];
    const accounts: PlatformAccount[] = raw.filter(isObj).map((a) => ({
      ref: String(a.ref ?? a.id ?? a._id ?? a.accountRef ?? ""),
      name: String(a.name ?? a.businessName ?? a.storeName ?? a.label ?? a.ref ?? ""),
    })).filter((a) => a.ref);
    if (!identity) throw new PlatformError(`Drop no devolvió token de identidad: ${text.slice(0, 300)}`);
    return { identity, accounts, cookie: cookiesFrom(res) };
  },

  async selectAccount(login, ref): Promise<Session> {
    const res = await fetch(`${API}/auth/accounts/select`, {
      method: "POST",
      headers: { ...BASE_HEADERS, authorization: `Bearer ${login.identity}`, ...(login.cookie ? { cookie: login.cookie } : {}) },
      body: JSON.stringify({ ref, identityToken: login.identity }),
      cache: "no-store",
    });
    const { json, text } = await readJson(res);
    if (!res.ok) throw new PlatformError(`No se pudo elegir la cuenta: ${errorMessage(json, text, res.status)}`);
    const token =
      findKey(json, (k) => /^access_?token$/i.test(k)) ??
      findKey(json, (k) => /^(token|jwt|session_?token|auth_?token)$/i.test(k)) ??
      findKey(json, (k) => /token/i.test(k) && !/refresh|identity/i.test(k));
    const cookie = cookiesFrom(res, login.cookie);
    if (!token && !cookie) throw new PlatformError(`Drop no devolvió sesión: ${text.slice(0, 300)}`);
    return { token, cookie, obtainedAt: Date.now() };
  },

  async discoverOrdersPath(session) {
    const attempts: ProbeAttempt[] = [];
    for (const path of ORDER_PATH_CANDIDATES) {
      try {
        const res = await fetch(`${API}${path}?page=1&limit=${PAGE_SIZE}`, { headers: authHeaders(session), cache: "no-store" });
        const { json, text } = await readJson(res);
        const orders = json ? extractOrders(json).length : 0;
        attempts.push({ path, status: res.status, orders, sample: text.slice(0, 400) });
        if (res.ok && orders > 0) return { path, attempts };
      } catch (e) {
        attempts.push({ path, status: -1, orders: 0, sample: String(e) });
      }
    }
    return { path: null, attempts };
  },

  async fetchOrders(session, path, page): Promise<OrdersPage> {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${API}${path}${sep}page=${page}&limit=${PAGE_SIZE}`;
    const res = await fetch(url, { headers: authHeaders(session), cache: "no-store" });
    if (res.status === 401 || res.status === 403) throw new SessionExpired();
    const { json, text } = await readJson(res);
    if (!res.ok || json === null) throw new PlatformError(errorMessage(json, text, res.status));
    return { url, payload: json };
  },
};

export const SOYDROP_PAGE_SIZE = PAGE_SIZE;
