import "server-only";
import { db } from "./supabase";
import { UUID, isCompany, type BankState } from "./reconciliation";
import { bankError } from "./reconciliation-data";

// Fuera de los archivos "use server": recibe quién lo hace, así que no puede quedar expuesta como acción.

const fail = (msg: string) => ({ ok: false as const, msg });

/** Vincula una liquidación con su comprobante. Lo usa también el registro de un PDF nuevo desde la liquidación. */
export async function linkPdf(settlementId: string, company: string, boxfulId: string, userId: string): Promise<BankState> {
  if (!UUID.test(settlementId) || !UUID.test(boxfulId) || !isCompany(company)) return fail("Liquidación o comprobante no válidos.");
  const [entry, exempt] = await Promise.all([
    db().from("bank_entries").select("id,source,void_reason").eq("id", boxfulId).eq("company", company).maybeSingle(),
    db().from("settlement_exempt_entries").select("id").eq("entry_id", boxfulId).is("revoked_at", null).limit(1),
  ]);
  if (entry.error || exempt.error) return fail("No se pudo revisar el comprobante. Actualiza la página.");
  if (!entry.data || entry.data.source !== "boxful" || entry.data.void_reason) return fail("Elige un comprobante de Boxful vigente de esta empresa.");
  if (exempt.data?.length) return fail("Ese comprobante está marcado como «no es liquidación». Quítale esa marca primero.");
  const { data, error } = await db()
    .from("settlements")
    .update({ boxful_id: boxfulId, linked_by: userId, linked_at: new Date().toISOString(), changed_by: userId })
    .eq("id", settlementId)
    .eq("company", company)
    .is("boxful_id", null)
    .select("id");
  if (error) return fail(error.code === "23505" ? "Ese comprobante ya está en otra liquidación." : bankError(error));
  if (!data?.length) return fail("La liquidación ya tiene comprobante. Actualiza la página.");
  return { ok: true, msg: "Comprobante vinculado." };
}

