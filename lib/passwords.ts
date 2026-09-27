// Contraseñas y sesiones firmadas, solo con node:crypto (sin dependencias). Sin "server-only"
// ni next/headers para poder usarlo en proxy.ts y en las pruebas.
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((ok, bad) => scryptCb(pw, salt, len, opts, (err, key) => (err ? bad(err) : ok(key))));

// scrypt N=2^15, r=8, p=1: ~50–100 ms por intento y ~32 MB de memoria
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

/** "scrypt$N$r$p$sal$hash" (sal y hash en base64). */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const N_ = Number(n), R_ = Number(r), P_ = Number(p);
  if (!N_ || !R_ || !P_ || expected.length < 32) return false;
  const key = await scrypt(pw.normalize("NFKC"), Buffer.from(salt, "base64"), expected.length, { N: N_, r: R_, p: P_, maxmem: MAXMEM });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/**
 * Hash de relleno: si el usuario no existe se verifica contra este, para que la respuesta
 * tarde lo mismo y no revele qué usuarios existen.
 */
let dummy: Promise<string> | null = null;
export const dummyHash = () => (dummy ??= hashPassword(randomBytes(12).toString("hex")));

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// ── sesión ────────────────────────────────────────────────────────────────────────────────
// Cookie "uid.version.exp.firma": identifica al usuario y la versión de sesión con que se firmó.
// La firma usa AUTH_SECRET (o, si no está, ENCRYPTION_KEY) derivado con un prefijo propio.

export const SESSION_COOKIE = "miranova_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;

export function sessionSecret(): string {
  const s = process.env.AUTH_SECRET || process.env.ENCRYPTION_KEY || process.env.DASHBOARD_PASSWORD;
  if (!s) throw new Error("Falta AUTH_SECRET (o ENCRYPTION_KEY) para firmar las sesiones");
  return s;
}

const key = (secret: string) => createHash("sha256").update(`miranova-session:${secret}`).digest();
const sign = (payload: string, secret: string) => createHmac("sha256", key(secret)).update(payload).digest("base64url");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function makeSessionToken(userId: string, version: number, secret = sessionSecret(), now = Date.now()): { value: string; maxAge: number } {
  const exp = Math.floor(now / 1000) + SESSION_MAX_AGE_S;
  const payload = `${userId}.${version}.${exp}`;
  return { value: `${payload}.${sign(payload, secret)}`, maxAge: SESSION_MAX_AGE_S };
}

/** Datos de la cookie si la firma es válida y no venció; no consulta la base. */
export function readSessionToken(token: string | undefined | null, secret = sessionSecret(), now = Date.now()): { userId: string; version: number } | null {
  if (!token || token.length > 300) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [userId, v, e, sig] = parts;
  const version = Number(v);
  const exp = Number(e);
  if (!UUID.test(userId) || !Number.isInteger(version) || version < 1 || !Number.isInteger(exp)) return null;
  if (exp * 1000 < now) return null;
  if (!safeEqual(sig, sign(`${userId}.${v}.${e}`, secret))) return null;
  return { userId, version };
}
