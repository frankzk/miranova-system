import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { SCOPE_COOKIE } from "@/lib/scope";

// Cerrar sesión: borra la sesión y la cuenta elegida (para que el siguiente usuario del
// mismo navegador no herede el filtro).
export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(SCOPE_COOKIE);
  return res;
}
