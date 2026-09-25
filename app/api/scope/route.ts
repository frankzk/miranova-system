import { NextResponse, type NextRequest } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { SCOPE_COOKIE } from "@/lib/scope";

// Cambia la cuenta activa del panel y vuelve a la página donde estaba.
export async function GET(req: NextRequest) {
  if (!(await isLoggedIn())) return NextResponse.redirect(new URL("/login", req.url));
  const account = req.nextUrl.searchParams.get("account") ?? "";
  const next = req.nextUrl.searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const res = NextResponse.redirect(new URL(safeNext, req.url), 303);
  if (account && /^[0-9a-f-]{36}$/i.test(account)) {
    res.cookies.set(SCOPE_COOKIE, account, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  } else {
    res.cookies.delete(SCOPE_COOKIE);
  }
  return res;
}
