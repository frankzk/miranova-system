import { NextResponse, type NextRequest } from "next/server";
import { safeNext, sessionCookie } from "@/lib/auth";
import { normalizeUsername } from "@/lib/permissions";
import { checkLogin } from "@/lib/users";

// Entrar con usuario y contraseña. Los errores vuelven a /login con un código (sin la contraseña).
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const username = normalizeUsername(String(form.get("username") ?? "")).slice(0, 80);
  const password = String(form.get("password") ?? "").slice(0, 200);
  const next = safeNext(String(form.get("next") ?? ""));

  const back = (error: string, extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ error, ...(username ? { u: username } : {}), ...(next !== "/" ? { next } : {}), ...extra });
    return NextResponse.redirect(new URL(`/login?${q}`, req.url), 303);
  };
  if (!username || !password) return back("invalid");

  const r = await checkLogin(username, password);
  if (!r.ok) return r.reason === "locked" ? back("locked", { m: String(r.minutes ?? 15) }) : back("invalid");

  const res = NextResponse.redirect(new URL(r.user.must_change_password ? "/account?first=1" : next, req.url), 303);
  res.cookies.set(sessionCookie(r.user.id, r.user.session_version));
  return res;
}
