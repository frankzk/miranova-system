import { NextResponse, type NextRequest } from "next/server";
import { newSessionToken, safeEqual, SESSION_COOKIE } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const expected = process.env.DASHBOARD_PASSWORD ?? "";

  if (!expected || !safeEqual(password, expected)) {
    return NextResponse.redirect(new URL("/login?error=1", req.url), 303);
  }

  const { value, maxAge } = newSessionToken();
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  return res;
}
