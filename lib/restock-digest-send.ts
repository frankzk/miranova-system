import "server-only";
import { appUrl, sendEmail } from "./email";
import { loadPanelEmail } from "./email-settings";
import { todayHN } from "./format";
import { inventoryStatus, inventorySupply } from "./inventory-data";
import { parseRecipients, restockDigest, type Digest } from "./restock-digest";

export type DigestRun =
  | { ok: true; sent: boolean; to: string[]; counts: Digest["counts"]; reason?: string; id?: string }
  | { ok: false; error: string; counts?: Digest["counts"] };

/** A quién le llega el resumen: lo de Ajustes → Correo; si está vacío, RESTOCK_DIGEST_TO de Vercel. */
export async function digestRecipients(): Promise<string[]> {
  const panel = await loadPanelEmail().catch(() => null);
  return panel?.digestTo.length ? panel.digestTo : parseRecipients(process.env.RESTOCK_DIGEST_TO);
}

/**
 * Arma el resumen de "qué pedir hoy" de todas las cuentas y lo envía.
 * Sin nada que pedir no se envía (salvo `force`, para probar la configuración).
 */
export async function runRestockDigest({ force = false }: { force?: boolean } = {}): Promise<DigestRun> {
  const to = await digestRecipients();
  if (!to.length) return { ok: false, error: "Falta a quién enviarle el resumen: agrégalo en Ajustes → Correo." };
  const [rows, supply] = await Promise.all([inventoryStatus(), inventorySupply()]);
  const digest = restockDigest(rows, supply, todayHN(), appUrl());
  if (digest.empty && !force) return { ok: true, sent: false, to, counts: digest.counts, reason: "Nada que pedir hoy." };
  const res = await sendEmail({ to, subject: digest.subject, html: digest.html, text: digest.text });
  if (!res.ok) return { ok: false, error: res.error, counts: digest.counts };
  return { ok: true, sent: true, to, counts: digest.counts, id: res.id };
}
