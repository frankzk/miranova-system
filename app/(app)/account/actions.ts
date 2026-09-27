"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser, sessionCookie } from "@/lib/auth";
import { passwordProblem } from "@/lib/permissions";
import { bumpSession, checkPassword, setPassword } from "@/lib/users";

export type AccountState = { ok: boolean; msg: string } | null;
const fail = (msg: string): AccountState => ({ ok: false, msg });

/** Cambia la contraseña propia (también la temporal) y cierra las demás sesiones. */
export async function changeOwnPassword(_prev: AccountState, form: FormData): Promise<AccountState> {
  // aquí se permite entrar con contraseña temporal: es justo lo que se viene a cambiar
  const user = await currentUser();
  if (!user) return fail("Tu sesión expiró. Vuelve a entrar.");

  const current = String(form.get("current") ?? "");
  const next = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (!(await checkPassword(user.id, current))) return fail("La contraseña actual no es correcta.");
  const weak = passwordProblem(next, user.username);
  if (weak) return fail(weak);
  if (next !== confirm) return fail("Las contraseñas nuevas no coinciden.");
  if (next === current) return fail("La contraseña nueva debe ser distinta de la actual.");

  const version = await setPassword(user.id, next, false);
  if (version === null) return fail("No se pudo cambiar la contraseña.");
  // esta sesión sigue abierta con la versión nueva; las demás quedan cerradas
  (await cookies()).set(sessionCookie(user.id, version));
  if (user.must_change_password) redirect("/");
  return { ok: true, msg: "Contraseña cambiada. Se cerraron tus sesiones en otros dispositivos." };
}

/** Cierra la sesión en todos los demás dispositivos. */
export async function closeOtherSessions(_prev: AccountState): Promise<AccountState> {
  const user = await currentUser();
  if (!user) return fail("Tu sesión expiró. Vuelve a entrar.");
  const version = await bumpSession(user.id);
  if (version === null) return fail("No se pudieron cerrar las sesiones.");
  (await cookies()).set(sessionCookie(user.id, version));
  return { ok: true, msg: "Listo: solo queda abierta esta sesión." };
}
