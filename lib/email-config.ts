// Con qué se envían los correos (puro, para probarlo). Variables en Vercel:
//   Gmail:  GMAIL_USER (la dirección) y GMAIL_APP_PASSWORD (contraseña de aplicación de 16 letras,
//           no la contraseña normal; requiere la verificación en 2 pasos en esa cuenta).
//   Resend: RESEND_API_KEY y, con dominio verificado, EMAIL_FROM.
// Si están las dos, se usa Gmail.

type Env = Record<string, string | undefined>;

export type EmailProvider = "gmail" | "resend" | null;

export function emailProvider(env: Env): EmailProvider {
  if (env.GMAIL_USER?.trim() && env.GMAIL_APP_PASSWORD?.trim()) return "gmail";
  if (env.RESEND_API_KEY?.trim()) return "resend";
  return null;
}

/** Google muestra la contraseña de aplicación en grupos ("abcd efgh ijkl mnop"): sin espacios. */
export const appPassword = (raw: string) => raw.replace(/\s+/g, "");

/** Remitente: EMAIL_FROM si está; si no, el nombre del panel con la dirección que envía. */
export const senderOf = (env: Env, address: string) => env.EMAIL_FROM?.trim() || `Miranova Inventario <${address}>`;

export const NOT_CONFIGURED =
  "Falta configurar el correo: agrega GMAIL_USER y GMAIL_APP_PASSWORD (o RESEND_API_KEY) en las variables de Vercel.";

/** Errores conocidos de los proveedores, en español y con qué hacer. */
export function explainSendError(provider: Exclude<EmailProvider, null>, message: string, code?: string): string {
  if (provider === "gmail" && (code === "EAUTH" || /Username and Password not accepted|Invalid login|535/i.test(message))) {
    return "Gmail no aceptó el usuario o la contraseña. Revisa GMAIL_USER y que GMAIL_APP_PASSWORD sea una contraseña de aplicación (no la contraseña normal de la cuenta).";
  }
  const testing = message.match(/only send testing emails to your own email address \(([^)]+)\)/i);
  if (provider === "resend" && testing) {
    return `Resend está en modo de prueba: solo deja enviar a ${testing[1]}. Para enviar a otros correos, verifica tu dominio en resend.com/domains o usa Gmail (GMAIL_USER y GMAIL_APP_PASSWORD).`;
  }
  return provider === "gmail" ? `Gmail: ${message}` : `Resend: ${message}`;
}
