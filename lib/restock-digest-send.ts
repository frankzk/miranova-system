import "server-only";
import { sendEmail } from "./email";
import { todayHN } from "./format";
import { inventoryStatus, inventorySupply } from "./inventory-data";
import { parseRecipients, restockDigest, type Digest } from "./restock-digest";

/** Dirección pública del panel, para el botón del correo. */
export function appUrl(): string {
  const explicit = process.env.APP_URL;
  if (explicit) return explicit;
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return prod ? `https://${prod}` : "http://localhost:3000";
}

export type DigestRun =
  | { ok: true; sent: boolean; to: string[]; counts: Digest["counts"]; reason?: string; id?: string }
  | { ok: false; error: string; counts?: Digest["counts"] };

/**
 * Arma el resumen de "qué pedir hoy" de todas las cuentas y lo envía a RESTOCK_DIGEST_TO.
 * Sin nada que pedir no se envía (salvo `force`, para probar la configuración).
 */
export async function runRestockDigest({ force = false }: { force?: boolean } = {}): Promise<DigestRun> {
  const to = parseRecipients(process.env.RESTOCK_DIGEST_TO);
  if (!to.length) return { ok: false, error: "Falta RESTOCK_DIGEST_TO (correo que recibe el resumen) en las variables de Vercel." };
  const [rows, supply] = await Promise.all([inventoryStatus(), inventorySupply()]);
  const digest = restockDigest(rows, supply, todayHN(), appUrl());
  if (digest.empty && !force) return { ok: true, sent: false, to, counts: digest.counts, reason: "Nada que pedir hoy." };
  const res = await sendEmail({ to, subject: digest.subject, html: digest.html, text: digest.text });
  if (!res.ok) return { ok: false, error: res.error, counts: digest.counts };
  return { ok: true, sent: true, to, counts: digest.counts, id: res.id };
}
