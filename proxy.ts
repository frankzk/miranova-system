import { NextResponse, type NextRequest } from "next/server";
import { readSessionToken, SESSION_COOKIE } from "@/lib/passwords";

// Revisión rápida en cada página del panel: sin una cookie de sesión firmada y vigente, a /login.
// No consulta la base (eso lo hacen las páginas, las acciones y las rutas de API, que además
// revisan que el usuario siga activo y sus permisos).
export function proxy(req: NextRequest) {
  let ok = false;
  try {
    ok = !!readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  } catch {
    ok = false;
  }
  if (ok) return NextResponse.next();
  const url = new URL("/login", req.url);
  const next = req.nextUrl.pathname + req.nextUrl.search;
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  // todo menos la API (se protege sola), el login, los archivos de Next y los íconos
  matcher: ["/((?!api/|login|_next/|icon\\.svg|apple-icon\\.png|favicon\\.ico|robots\\.txt).*)"],
};
