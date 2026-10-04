import "server-only";

// Correo saliente por Resend (https://resend.com). Variables en Vercel:
//   RESEND_API_KEY  clave de la API de Resend
//   EMAIL_FROM      remitente, p. ej. "Miranova <inventario@tudominio.com>" (dominio verificado en Resend).
//                   Sin dominio verificado, Resend solo deja enviar desde onboarding@resend.dev y
//                   solo al correo con el que se creó la cuenta de Resend.

export type Email = { to: string[]; subject: string; html: string; text: string };
export type SendResult = { ok: true; id: string } | { ok: false; error: string };

export async function sendEmail(e: Email): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "Falta RESEND_API_KEY en las variables de Vercel." };
  if (!e.to.length) return { ok: false, error: "No hay destinatarios." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || "Miranova <onboarding@resend.dev>", to: e.to, subject: e.subject, html: e.html, text: e.text }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: body.message ? `Resend: ${body.message}` : `Resend respondió ${res.status}.` };
    return { ok: true, id: body.id ?? "" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `No se pudo conectar con Resend: ${err.message}` : "No se pudo conectar con Resend." };
  }
}
