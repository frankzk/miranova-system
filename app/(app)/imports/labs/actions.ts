"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth";
import { todayIn } from "@/lib/format";
import { cleanLabPurchase, isLabStatus, LAB_DESTINATIONS, labStatus, type LabFields } from "@/lib/lab-purchases";
import { can } from "@/lib/permissions";
import { db } from "@/lib/supabase";

// Compras › Laboratorios: crear, editar, cambiar de estado y borrar.

export type LabFormState = { ok: boolean; msg: string } | null;

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (msg: string): LabFormState => ({ ok: false, msg });
const GONE = "Esa compra ya no existe.";

/** Sin permiso de Dinero, el precio y el tipo de cambio guardados no se tocan. */
const withoutMoney = ({ unit_price_gtq: _p, fx_gtq_per_usd: _fx, ...rest }: LabFields) => rest;

/** Nueva o editada. */
export async function saveLabPurchase(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const money = can(auth.user, "money");
  const id = field(form, "id");
  if (id && !UUID.test(id)) return fail(GONE);
  const c = cleanLabPurchase(
    {
      product: field(form, "product"),
      lab_name: field(form, "lab_name"),
      status: field(form, "status"),
      requested_at: field(form, "requested_at"),
      shipped_at: field(form, "shipped_at"),
      arrived_at: field(form, "arrived_at"),
      boxes: field(form, "boxes"),
      qty_requested: field(form, "qty_requested"),
      qty_courtesy: field(form, "qty_courtesy"),
      distribution: Object.fromEntries(LAB_DESTINATIONS.map((d) => [d.id, field(form, `d_${d.id}`)])),
      unit_price_gtq: field(form, "unit_price_gtq"),
      fx_gtq_per_usd: field(form, "fx_gtq_per_usd"),
      notes: field(form, "notes"),
    },
    todayIn(),
    money,
  );
  if (!c.ok) return fail(c.msg);
  const row = money ? c.row : withoutMoney(c.row);
  const now = new Date().toISOString();
  if (id) {
    const { data, error } = await db().from("lab_purchases").update({ ...row, updated_at: now }).eq("id", id).select("id");
    if (error) return fail(`No se pudo guardar: ${error.message}`);
    if (!data?.length) return fail(GONE);
  } else {
    const { error } = await db().from("lab_purchases").insert({ ...row, created_by: auth.user.id, created_at: now, updated_at: now });
    if (error) return fail(`No se pudo guardar: ${error.message}`);
  }
  revalidatePath("/imports/labs");
  return { ok: true, msg: id ? "Guardado." : `Compra de ${c.row.product} guardada.` };
}

/** Cambio rápido de estado desde la lista; al pasar a "Llegó a bodega" sin fecha, se anota hoy. */
export async function setLabStatus(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const id = field(form, "id");
  const status = field(form, "status");
  if (!UUID.test(id)) return fail(GONE);
  if (!isLabStatus(status)) return fail("Estado no válido.");
  const { data: cur, error: readErr } = await db().from("lab_purchases").select("arrived_at, requested_at").eq("id", id).maybeSingle();
  if (readErr) return fail(`No se pudo cambiar: ${readErr.message}`);
  if (!cur) return fail(GONE);
  const today = todayIn();
  const patch: Record<string, string> = { status, updated_at: new Date().toISOString() };
  if (status === "arrived" && !cur.arrived_at) patch.arrived_at = today < cur.requested_at ? cur.requested_at : today;
  const { error } = await db().from("lab_purchases").update(patch).eq("id", id);
  if (error) return fail(`No se pudo cambiar: ${error.message}`);
  revalidatePath("/imports/labs");
  return { ok: true, msg: labStatus(status).label };
}

export async function deleteLabPurchase(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  const auth = await authorizeAction("imports");
  if (!auth.ok) return auth;
  const id = field(form, "id");
  if (!UUID.test(id)) return fail(GONE);
  const { error } = await db().from("lab_purchases").delete().eq("id", id);
  if (error) return fail(`No se pudo borrar: ${error.message}`);
  revalidatePath("/imports/labs");
  return { ok: true, msg: "Compra borrada." };
}
