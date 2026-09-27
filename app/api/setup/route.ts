import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/passwords";
import { sessionCookie } from "@/lib/auth";
import { normalizeUsername, passwordProblem, PERMISSION_KEYS, USERNAME_RE } from "@/lib/permissions";
import { createUser, userCount } from "@/lib/users";

// Primer usuario (el dueño): solo mientras no exista ningún usuario, y con la contraseña
// anterior del panel (DASHBOARD_PASSWORD) como prueba de que es quien administraba el panel.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const back = (error: string) => NextResponse.redirect(new URL(`/login?setup=1&error=${error}`, req.url), 303);

  if ((await userCount()) > 0) return NextResponse.redirect(new URL("/login", req.url), 303);

  const panel = String(form.get("panel_password") ?? "");
  const expected = process.env.DASHBOARD_PASSWORD ?? "";
  if (!expected || !safeEqual(panel, expected)) return back("panel");

  const username = normalizeUsername(String(form.get("username") ?? ""));
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (!USERNAME_RE.test(username)) return back("username");
  if (!name) return back("name");
  if (passwordProblem(password, username)) return back("weak");
  if (password !== confirm) return back("mismatch");

  const created = await createUser({ username, name, password, permissions: PERMISSION_KEYS, is_owner: true });
  if ("error" in created) return back("exists");

  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(sessionCookie(created.id, 1));
  return res;
}
