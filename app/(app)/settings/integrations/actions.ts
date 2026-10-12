"use server";

import { revalidatePath } from "next/cache";
import type { ImportFormState } from "@/components/import-forms";
import { authorizeAction } from "@/lib/auth";
import { integrationKey, saveIntegrations } from "@/lib/integrations";
import { trackStatusInfo } from "@/lib/tracking17";
import { dhlTrack } from "@/lib/tracking-dhl-client";

// Ajustes → Integraciones: solo el dueño. Las claves se guardan cifradas y nunca se muestran.

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const fail = (msg: string): ImportFormState => ({ ok: false, msg });

export async function saveIntegrationsAction(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction();
  if (!auth.ok) return fail(auth.msg);
  if (!auth.user.is_owner) return fail("Solo el dueño puede cambiar las integraciones.");
  const dhl = field(form, "dhl_key").replace(/\s+/g, "");
  const track = field(form, "track17_key").replace(/\s+/g, "");
  const anthropic = field(form, "anthropic_key").replace(/\s+/g, "");
  if (dhl && (dhl.length < 16 || dhl.length > 200)) return fail("La clave de DHL no parece completa: cópiala de nuevo desde developer.dhl.com → My Apps → tu app → API Key.");
  if (track && (track.length < 16 || track.length > 200)) return fail("La clave de 17TRACK no parece completa: cópiala de nuevo desde su panel (Settings → Security → Access Key).");
  if (anthropic && (!anthropic.startsWith("sk-ant-") || anthropic.length < 30)) return fail("La clave de Anthropic empieza con sk-ant-: cópiala completa desde console.anthropic.com → API Keys.");
  const err = await saveIntegrations(
    {
      dhl: { key: dhl, clear: form.get("dhl_clear") === "1" },
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

/** Consulta una guía en DHL con la clave guardada y cuenta qué respondió (no guarda nada). */
export async function testDhlAction(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction();
  if (!auth.ok) return fail(auth.msg);
  if (!auth.user.is_owner) return fail("Solo el dueño puede probar las integraciones.");
  const number = field(form, "number").replace(/[\s-]+/g, "").slice(0, 40);
  if (!/^[A-Za-z0-9]{6,40}$/.test(number)) return fail("Escribe el número de guía DHL (solo letras y números).");
  const key = await integrationKey("dhl");
  if (!key) return fail("Primero guarda la clave de DHL arriba.");
  try {
    const r = await dhlTrack(number, key);
    if (!r.found) return fail(`La clave funciona, pero DHL todavía no tiene información de la guía ${number}: revisa el número.`);
    const { info } = r;
    const last = info.latest ? ` Última novedad: “${info.latest.text}”${info.latest.location ? ` en ${info.latest.location}` : ""} (${when.format(new Date(info.latest.at))}).` : "";
    const eta = info.eta ? ` DHL estima que llega el ${info.eta.split("-").reverse().join("/")}.` : "";
    return { ok: true, msg: `La clave funciona. Guía ${number}: ${trackStatusInfo(info.status).label}.${last}${eta}` };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "No se pudo consultar a DHL.");
  }
}
