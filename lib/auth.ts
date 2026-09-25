import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const SESSION_COOKIE = "miranova_session";
const MAX_AGE_S = 60 * 60 * 24 * 30;

function secret(): string {
  const s = process.env.DASHBOARD_PASSWORD;
  if (!s) throw new Error("Falta DASHBOARD_PASSWORD");
  return s;
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function sign(exp: number): string {
  return createHmac("sha256", secret()).update(`session:${exp}`).digest("hex");
}

export function newSessionToken(): { value: string; maxAge: number } {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  return { value: `${exp}.${sign(exp)}`, maxAge: MAX_AGE_S };
}

export async function isLoggedIn(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!exp || !sig || exp < Date.now() / 1000) return false;
  return safeEqual(sig, sign(exp));
}

export async function requireLogin(): Promise<void> {
  if (!(await isLoggedIn())) redirect("/login");
}

/** Valida la API key que usa la extensión de Chrome. */
export function isValidIngestKey(key: string | null): boolean {
  const expected = process.env.INGEST_API_KEY;
  return !!expected && !!key && safeEqual(key, expected);
}
