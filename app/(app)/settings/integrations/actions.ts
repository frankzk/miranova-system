"use server";

import { revalidatePath } from "next/cache";
import type { ImportFormState } from "@/components/import-forms";
import { authorizeAction } from "@/lib/auth";
import { saveIntegrations } from "@/lib/integrations";

// Ajustes → Integraciones: solo el dueño. Las claves se guardan cifradas y nunca se muestran.

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const fail = (msg: string): ImportFormState => ({ ok: false, msg });

export async function saveIntegrationsAction(_prev: ImportFormState, form: FormData): Promise<ImportFormState> {
  const auth = await authorizeAction();
  if (!auth.ok) return fail(auth.msg);
  if (!auth.user.is_owner) return fail("Solo el dueño puede cambiar las integraciones.");
  const track = field(form, "track17_key").replace(/\s+/g, "");
  const anthropic = field(form, "anthropic_key").replace(/\s+/g, "");
  if (track && (track.length < 16 || track.length > 200)) return fail("La clave de 17TRACK no parece completa: cópiala de nuevo desde su panel (Settings → Security → Access Key).");
  if (anthropic && (!anthropic.startsWith("sk-ant-") || anthropic.length < 30)) return fail("La clave de Anthropic empieza con sk-ant-: cópiala completa desde console.anthropic.com → API Keys.");
  const err = await saveIntegrations(
    {
      track17: { key: track, clear: form.get("track17_clear") === "1" },
      anthropic: { key: anthropic, clear: form.get("anthropic_clear") === "1" },
    },
    auth.user.id,
  );
  if (err) return fail(`No se pudo guardar: ${err}`);
  revalidatePath("/settings/integrations");
  return { ok: true, msg: "Guardado." };
}
