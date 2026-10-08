"use server";

import { revalidatePath } from "next/cache";
import type { EmailFormState } from "@/components/email-settings-form";
import { authorizeAction } from "@/lib/auth";
import { emailStatus, sendEmail } from "@/lib/email";
import { appPassword, isEmailAddress } from "@/lib/email-config";
import { loadPanelEmail, savePanelEmail } from "@/lib/email-settings";
import { digestRecipients } from "@/lib/restock-digest-send";

// Ajustes → Correo: solo el dueño.

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const fail = (msg: string): EmailFormState => ({ ok: false, msg });

async function owner() {
  const auth = await authorizeAction();
  if (!auth.ok) return auth;
  if (!auth.user.is_owner) return { ok: false as const, msg: "Solo el dueño puede cambiar el correo del panel." };
  return auth;
}

export async function saveEmailSettingsAction(_prev: EmailFormState, form: FormData): Promise<EmailFormState> {
  const auth = await owner();
  if (!auth.ok) return fail(auth.msg);

  const gmailUser = field(form, "gmail_user").toLowerCase();
  if (gmailUser && !isEmailAddress(gmailUser)) return fail("El correo que envía no es válido.");
  const newPassword = field(form, "gmail_app_password");
  // la contraseña de aplicación son 16 letras: así no se guarda por error la contraseña normal
  if (newPassword && !/^[a-z]{16}$/i.test(appPassword(newPassword))) {
    return fail("La contraseña de aplicación tiene 16 letras (Google la muestra en 4 grupos de 4). No uses la contraseña normal de la cuenta.");
  }
  const current = await loadPanelEmail();
  if (gmailUser && !newPassword && !(current?.gmailUser === gmailUser && current.gmailAppPassword)) {
    return fail("Falta la contraseña de aplicación de esa cuenta.");
  }

  const tokens = field(form, "digest_to").split(/[,;\s]+/).filter(Boolean);
  const bad = tokens.filter((t) => !isEmailAddress(t));
  if (bad.length) return fail(`Revisa estos correos del resumen: ${bad.join(", ")}`);
  const digestTo = [...new Set(tokens.map((t) => t.toLowerCase()))];

  const err = await savePanelEmail({ gmailUser: gmailUser || null, newPassword, digestTo }, auth.user.id);
  if (err) return fail(`No se pudo guardar: ${err}`);
  revalidatePath("/settings/email");
  return { ok: true, msg: "Guardado." };
}

export async function sendTestEmailAction(_prev: EmailFormState, _form: FormData): Promise<EmailFormState> {
  const auth = await owner();
  if (!auth.ok) return fail(auth.msg);
  const status = await emailStatus();
  const recipients = await digestRecipients();
  const to = recipients.length ? recipients : status.sender && isEmailAddress(status.sender) ? [status.sender] : [];
  if (!to.length) return fail("Agrega a quién le llega el resumen para enviarle la prueba.");
  const r = await sendEmail({
    to,
    subject: "Prueba de correo del panel Miranova",
    text: "Si te llegó este correo, el envío del panel está bien configurado. Aquí llegará el resumen diario de inventario.",
    html: `<p style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#0a2540">Si te llegó este correo, el envío del panel está bien configurado. Aquí llegará el resumen diario de inventario.</p>`,
  });
  return r.ok ? { ok: true, msg: `Correo de prueba enviado a ${to.join(", ")}.` } : fail(r.error);
}
