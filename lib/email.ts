import "server-only";
import nodemailer from "nodemailer";
import { appPassword, effectiveEnv, emailProvider, explainSendError, NOT_CONFIGURED, senderOf, type EmailProvider, type Env } from "./email-config";
import { loadPanelEmail } from "./email-settings";

// Correo saliente por Gmail (SMTP con contraseña de aplicación) o por Resend. La cuenta de Gmail de
// Ajustes → Correo gana sobre las variables de Vercel. Ver lib/email-config.ts.

export type Email = { to: string[]; subject: string; html: string; text: string };
export type SendResult = { ok: true; id: string } | { ok: false; error: string };

/** Dirección pública del panel, para los botones de los correos. */
export function appUrl(): string {
  const explicit = process.env.APP_URL;
  if (explicit) return explicit;
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return prod ? `https://${prod}` : "http://localhost:3000";
}

async function config(): Promise<Env> {
  const panel = await loadPanelEmail().catch(() => null);
  return effectiveEnv(panel, process.env);
}

/** Con qué se envía hoy y desde qué dirección (para Ajustes → Correo). */
export async function emailStatus(): Promise<{ provider: EmailProvider; sender: string | null; source: "panel" | "vercel" | null }> {
  const panel = await loadPanelEmail().catch(() => null);
  const env = effectiveEnv(panel, process.env);
  const provider = emailProvider(env);
  const fromPanel = Boolean(panel?.gmailUser && panel.gmailAppPassword);
  return {
    provider,
    sender: provider === "gmail" ? env.GMAIL_USER!.trim() : provider === "resend" ? senderOf(env, "onboarding@resend.dev") : null,
    source: provider ? (fromPanel ? "panel" : "vercel") : null,
  };
}

export async function sendEmail(e: Email): Promise<SendResult> {
  if (!e.to.length) return { ok: false, error: "No hay destinatarios." };
  const env = await config();
  const provider = emailProvider(env);
  if (provider === "gmail") return viaGmail(e, env);
  if (provider === "resend") return viaResend(e, env);
  return { ok: false, error: NOT_CONFIGURED };
}

async function viaGmail(e: Email, env: Env): Promise<SendResult> {
  const user = env.GMAIL_USER!.trim();
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass: appPassword(env.GMAIL_APP_PASSWORD!) },
    connectionTimeout: 15_000,
    socketTimeout: 20_000,
  });
  try {
    const info = await transport.sendMail({ from: senderOf(env, user), to: e.to, subject: e.subject, html: e.html, text: e.text });
    return { ok: true, id: info.messageId };
  } catch (err) {
    const { message = "no se pudo enviar", code } = err as { message?: string; code?: string };
    return { ok: false, error: explainSendError("gmail", message, code) };
  } finally {
    transport.close();
  }
}

async function viaResend(e: Email, env: Env): Promise<SendResult> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: senderOf(env, "onboarding@resend.dev"), to: e.to, subject: e.subject, html: e.html, text: e.text }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: explainSendError("resend", body.message ?? `respondió ${res.status}`) };
    return { ok: true, id: body.id ?? "" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `No se pudo conectar con Resend: ${err.message}` : "No se pudo conectar con Resend." };
  }
}
