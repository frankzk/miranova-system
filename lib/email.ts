import "server-only";
import nodemailer from "nodemailer";
import { appPassword, emailProvider, explainSendError, NOT_CONFIGURED, senderOf } from "./email-config";

// Correo saliente por Gmail (SMTP con contraseña de aplicación) o por Resend. Ver lib/email-config.ts.

export type Email = { to: string[]; subject: string; html: string; text: string };
export type SendResult = { ok: true; id: string } | { ok: false; error: string };

export async function sendEmail(e: Email): Promise<SendResult> {
  if (!e.to.length) return { ok: false, error: "No hay destinatarios." };
  const provider = emailProvider(process.env);
  if (provider === "gmail") return viaGmail(e);
  if (provider === "resend") return viaResend(e);
  return { ok: false, error: NOT_CONFIGURED };
}

async function viaGmail(e: Email): Promise<SendResult> {
  const user = process.env.GMAIL_USER!.trim();
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass: appPassword(process.env.GMAIL_APP_PASSWORD!) },
    connectionTimeout: 15_000,
    socketTimeout: 20_000,
  });
  try {
    const info = await transport.sendMail({ from: senderOf(process.env, user), to: e.to, subject: e.subject, html: e.html, text: e.text });
    return { ok: true, id: info.messageId };
  } catch (err) {
    const { message = "no se pudo enviar", code } = err as { message?: string; code?: string };
    return { ok: false, error: explainSendError("gmail", message, code) };
  } finally {
    transport.close();
  }
}

async function viaResend(e: Email): Promise<SendResult> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: senderOf(process.env, "onboarding@resend.dev"), to: e.to, subject: e.subject, html: e.html, text: e.text }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: explainSendError("resend", body.message ?? `respondió ${res.status}`) };
    return { ok: true, id: body.id ?? "" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `No se pudo conectar con Resend: ${err.message}` : "No se pudo conectar con Resend." };
  }
}
