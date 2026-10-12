"use server";

import { revalidatePath } from "next/cache";
import type { ImportFormState } from "@/components/import-forms";
import { authorizeAction } from "@/lib/auth";
import { carrierTracker, PROVIDER_LABEL, trackingKeys, type Carrier } from "@/lib/carrier-tracking";
import { saveIntegrations } from "@/lib/integrations";
import { trackStatusInfo } from "@/lib/tracking17";

// Ajustes → Integraciones: solo el dueño. Las claves se guardan cifradas y nunca se muestran.

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const fail = (msg: string): ImportFormState => ({ ok: false, msg });

export async function saveIntegrationsAction(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction();
  if (!auth.ok) return fail(auth.msg);
  if (!auth.user.is_owner) return fail("Solo el dueño puede cambiar las integraciones.");
  const key = (k: string) => field(form, k).replace(/\s+/g, "");
  const dhl = key("dhl_key");
  const fedexId = key("fedex_id_key");
  const fedexSecret = key("fedex_secret_key");
  const upsId = key("ups_id_key");
  const upsSecret = key("ups_secret_key");
  const track = field(form, "track17_key").replace(/\s+/g, "");
  const anthropic = field(form, "anthropic_key").replace(/\s+/g, "");
  if (dhl && (dhl.length < 16 || dhl.length > 200)) return fail("La clave de DHL no parece completa: cópiala de nuevo desde developer.dhl.com → My Apps → tu app → API Key.");
  for (const [v, what] of [[fedexId, "la API Key de FedEx"], [fedexSecret, "la Secret Key de FedEx"], [upsId, "el Client ID de UPS"], [upsSecret, "el Client Secret de UPS"]] as const) {
    if (v && (v.length < 16 || v.length > 200)) return fail(`${what.charAt(0).toUpperCase()}${what.slice(1)} no parece completa: cópiala de nuevo desde su portal.`);
  }
  if (track && (track.length < 16 || track.length > 200)) return fail("La clave de 17TRACK no parece completa: cópiala de nuevo desde su panel (Settings → Security → Access Key).");
  if (anthropic && (!anthropic.startsWith("sk-ant-") || anthropic.length < 30)) return fail("La clave de Anthropic empieza con sk-ant-: cópiala completa desde console.anthropic.com → API Keys.");
  const err = await saveIntegrations(
    {
      dhl: { key: dhl, clear: form.get("dhl_clear") === "1" },
      fedex_id: { key: fedexId, clear: form.get("fedex_clear") === "1" },
      fedex_secret: { key: fedexSecret, clear: form.get("fedex_clear") === "1" },
      ups_id: { key: upsId, clear: form.get("ups_clear") === "1" },
      ups_secret: { key: upsSecret, clear: form.get("ups_clear") === "1" },
      track17: { key: track, clear: form.get("track17_clear") === "1" },
      anthropic: { key: anthropic, clear: form.get("anthropic_clear") === "1" },
    },
    auth.user.id,
  );
  if (err) return fail(`No se pudo guardar: ${err}`);
  revalidatePath("/settings/integrations");
  return { ok: true, msg: "Guardado." };
}

const when = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Tegucigalpa" });

/** Consulta una guía en DHL, FedEx o UPS con las claves guardadas y cuenta qué respondió (no guarda nada). */
export async function testTrackingAction(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction();
  if (!auth.ok) return fail(auth.msg);
  if (!auth.user.is_owner) return fail("Solo el dueño puede probar las integraciones.");
  const carrier = field(form, "carrier") as Carrier;
  if (!["dhl", "fedex", "ups"].includes(carrier)) return fail("Elige la paquetera.");
  const label = PROVIDER_LABEL[carrier];
  const number = field(form, "number").replace(/[\s-]+/g, "").slice(0, 40);
  if (!/^[A-Za-z0-9]{6,40}$/.test(number)) return fail(`Escribe el número de guía de ${label} (solo letras y números).`);
  const keys = await trackingKeys();
  if (!keys[carrier]) return fail(`Primero guarda ${carrier === "dhl" ? "la clave" : "las dos claves"} de ${label} arriba.`);
  try {
    const r = await carrierTracker(carrier, keys).track(number);
    if (!r.found) return fail(`La clave funciona, pero ${label} todavía no tiene información de la guía ${number}: revisa el número.`);
    const { info } = r;
    const last = info.latest ? ` Última novedad: “${info.latest.text}”${info.latest.location ? ` en ${info.latest.location}` : ""} (${when.format(new Date(info.latest.at))}).` : "";
    const eta = info.eta ? ` ${label} estima que llega el ${info.eta.split("-").reverse().join("/")}.` : "";
    return { ok: true, msg: `La clave funciona. Guía ${number}: ${trackStatusInfo(info.status).label}.${last}${eta}` };
  } catch (e) {
    return fail(e instanceof Error ? e.message : `No se pudo consultar a ${label}.`);
  }
}
