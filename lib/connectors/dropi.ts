import { totp } from "../totp.ts";
import {
  type Connector, type DateRange, type LoginResult, type OrdersPage, type ProbeAttempt, type Session,
  PlatformError, SessionExpired,
} from "./types.ts";

// Conector para Dropi (app.dropi.<país>). Rutas vistas en la red de app.dropi.gt:
//   POST api-v2.dropi.gt/bff/auth/core/login  { email, password, otp, white_brand_id, ... } → token JWT (12 h)
//   GET  api.dropi.gt/api/orders/myorders/v2?supplier_id=…&from=YYYY-MM-DD&until=…&start=…&result_number=…
// El token va en la cabecera "x-authorization: Bearer …". Si la cuenta tiene
// verificación en dos pasos, el campo `otp` lleva el código de 6 dígitos, que
// generamos con la clave secreta 2FA guardada (cifrada) en la cuenta.

const PAGE_SIZE = 50;
const ORDERS_PATH = "/api/orders/myorders/v2";

/** Dominio de Dropi por país (confirmado: Guatemala). */
const DOMAINS: Record<string, string> = { GT: "dropi.gt", CO: "dropi.co", MX: "dropi.mx", EC: "dropi.ec", CL: "dropi.cl", PE: "dropi.pe", PA: "dropi.pa", PY: "dropi.com.py" };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const JWT = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/;

function findString(node: unknown, test: (k: string, v: string) => boolean, depth = 0): string | undefined {
  if (!isObj(node) || depth > 4) return undefined;
  for (const [k, v] of Object.entries(node)) if (typeof v === "string" && v && test(k, v)) return v;
  for (const v of Object.values(node)) {
    const r = findString(v, test, depth + 1);
    if (r) return r;
  }
  return undefined;
}

function findArray(node: unknown, depth = 0): unknown[] | undefined {
  if (Array.isArray(node)) return node;
  if (!isObj(node) || depth > 3) return undefined;
  for (const k of ["objects", "data", "orders", "rows", "items", "results"]) if (Array.isArray(node[k])) return node[k] as unknown[];
  for (const v of Object.values(node)) {
    const r = findArray(v, depth + 1);
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

const messageOf = (json: unknown, text: string) =>
  findString(json, (k) => /^(message|error|detail|msg)$/i.test(k)) ?? text.slice(0, 200);

function jwtClaim(token: string | undefined, key: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token!.split(".")[1], "base64url").toString("utf8"));
    const v = payload?.[key];
    return v === undefined || v === null ? undefined : String(v);
  } catch {
    return undefined;
  }
}

/** Fecha YYYY-MM-DD en la zona del país (el filtro de Dropi es por día local). */
const day = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);

async function publicIp(): Promise<string> {
  try {
    const res = await fetch("https://api.ipify.org?format=json", { cache: "no-store", signal: AbortSignal.timeout(3000) });
    return String(((await res.json()) as Obj).ip ?? "");
  } catch {
    return "";
  }
}

export function dropi(country: string, timezone = "America/Guatemala"): Connector {
  const domain = DOMAINS[country] ?? `dropi.${country.toLowerCase()}`;
  const AUTH = process.env.DROPI_AUTH_URL ?? `https://api-v2.${domain}`;
  const API = process.env.DROPI_API_URL ?? `https://api.${domain}`;
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    origin: `https://app.${domain}`,
    referer: `https://app.${domain}/`,
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
  };
  const auth = (s: Session) => ({ ...headers, "x-authorization": `Bearer ${s.token}` });

  async function getOrders(session: Session, page: number, size: number, range?: DateRange): Promise<OrdersPage> {
    const supplier = jwtClaim(session.token, "sub");
    const to = range?.to ?? new Date(Date.now() + 86_400_000);
    const from = range?.from ?? new Date(to.getTime() - 30 * 86_400_000);
    const params = new URLSearchParams({
      exportAs: "orderByRow", orderBy: "id", orderDirection: "desc",
      result_number: String(size), start: String((page - 1) * size),
      textToSearch: "", status: "null", supplier_id: supplier ?? "null", user_id: "null",
      from: day(from, timezone), until: day(to, timezone),
      filter_product: "undefined", radio_downloaded: "IMPRESAS Y NO IMPRESAS", tag_id: "",
      warranty: "false", filter_date_by: "null", invoiced: "null",
    });
    const url = `${API}${ORDERS_PATH}?${params}`;
    const res = await fetch(url, { headers: auth(session), cache: "no-store" });
    if (res.status === 401 || res.status === 403) throw new SessionExpired();
    const { json, text } = await readJson(res);
    if (isObj(json) && json.isSuccess === false && (json.status === 401 || /token|unauthori[sz]ed|no autorizado/i.test(messageOf(json, text)))) {
      throw new SessionExpired();
    }
    if (!res.ok || json === null) throw new PlatformError(`Dropi respondió ${res.status}: ${messageOf(json, text)}`);
    return { url, payload: json, rows: findArray(json)?.length ?? 0 };
  }

  return {
    pageSize: PAGE_SIZE,

    async login(email, password, opts): Promise<LoginResult> {
      const otp = opts?.totpSecret ? totp(opts.totpSecret) : null;
      const res = await fetch(`${AUTH}/bff/auth/core/login`, {
        method: "POST",
        headers: { ...headers, "x-authorization": "Bearer undefined", "x-captcha-token": "" },
        body: JSON.stringify({ email, password, white_brand_id: 1, brand: "", ipAddress: await publicIp(), otp, with_cdc: false }),
        cache: "no-store",
      });
      const { json, text } = await readJson(res);
      const token = findString(json, (k, v) => /^(token|access_?token|jwt)$/i.test(k) && JWT.test(v)) ?? findString(json, (_, v) => JWT.test(v));
      if (!token) {
        const msg = messageOf(json, text);
        if (/otp|2fa|dos (factores|pasos)|two.?factor|autenticaci[oó]n|c[oó]digo/i.test(msg) || (!otp && /otp/i.test(text))) {
          throw new PlatformError(
            otp
              ? `Dropi rechazó el código 2FA (${msg}). Revisa la clave 2FA guardada en esta cuenta.`
              : `Dropi pide verificación en dos pasos: agrega la clave 2FA en "Más opciones" de esta cuenta (${msg}).`,
          );
        }
        if (res.status === 401 || res.status === 400 || res.status === 422 || /credencial|contrase|password|incorrect/i.test(msg)) {
          throw new PlatformError(`Correo o contraseña incorrectos (Dropi respondió ${res.status}: ${msg})`);
        }
        throw new PlatformError(`Dropi no devolvió sesión (${res.status}): ${msg}`);
      }
      const ref = jwtClaim(token, "sub") ?? email;
      const name = findString(json, (k) => /^(name|store_name|business_name)$/i.test(k)) ?? email;
      return { identity: token, accounts: [{ ref, name }] };
    },

    async selectAccount(login): Promise<Session> {
      return { token: login.identity, obtainedAt: Date.now() };
    },

    // La ruta es fija; solo comprobamos que la sesión sirve.
    async discoverOrdersPath(session) {
      const attempts: ProbeAttempt[] = [];
      try {
        const page = await getOrders(session, 1, 1);
        attempts.push({ path: ORDERS_PATH, status: 200, orders: page.rows ?? 0, sample: JSON.stringify(page.payload).slice(0, 400) });
        return { path: ORDERS_PATH, attempts };
      } catch (e) {
        if (e instanceof SessionExpired) attempts.push({ path: ORDERS_PATH, status: 401, orders: 0, sample: "sesión rechazada" });
        else attempts.push({ path: ORDERS_PATH, status: -1, orders: 0, sample: String(e) });
        return { path: null, attempts };
      }
    },

    fetchOrders(session, _path, page, range) {
      return getOrders(session, page, PAGE_SIZE, range);
    },
  };
}
