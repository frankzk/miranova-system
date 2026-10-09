"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "./auth";
import { safeNext } from "./permissions";
import { SCOPE_COOKIE } from "./scope";

/**
 * Cambia la cuenta activa del panel y vuelve a la página donde estaba. Como acción del servidor
 * es una navegación del cliente (no recarga la página entera) y, al cambiar la cookie, Next
 * descarta las secciones guardadas en el navegador para que ninguna muestre la cuenta anterior.
 */
export async function setScopeAction(form: FormData): Promise<void> {
  if (!(await currentUser())) redirect("/login");
  const account = String(form.get("account") ?? "");
  const jar = await cookies();
  if (/^[0-9a-f-]{36}$/i.test(account)) {
    jar.set(SCOPE_COOKIE, account, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  } else {
    jar.delete(SCOPE_COOKIE);
  }
  redirect(safeNext(String(form.get("next") ?? "")));
}
