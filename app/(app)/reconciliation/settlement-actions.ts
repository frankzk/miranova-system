"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { UUID, isCompany, type BankState } from "@/lib/reconciliation";
import { bankError } from "@/lib/reconciliation-data";
import { linkPdf } from "@/lib/settlements-link";

// Liquidaciones (3 pasos). La plataforma las trae solas; aquí solo lo que confirma una persona:
// el PDF de cada una, la revisión de las rechazadas y los comprobantes que no son liquidación.
// Cada cambio queda en bank_audit (triggers de la migración settlements).

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const fail = (msg: string) => ({ ok: false as const, msg });
const done = (msg: string) => {
  revalidatePath("/reconciliation");
  return { ok: true as const, msg };
};

export async function linkSettlementPdf(_prev: BankState, form: FormData): Promise<BankState> {
  const auth = await authorizeAction("reconciliation");
  if (!auth.ok) return auth;
  const r = await linkPdf(field(form, "settlement_id"), field(form, "company"), field(form, "boxful_id"), auth.user.id);
  return r?.ok ? done(r.msg) : r;
}

export async function unlinkSettlementPdf(_prev: BankState, form: FormData): Promise<BankState> {
  const auth = await authorizeAction("reconciliation");
  if (!auth.ok) return auth;
  const id = field(form, "settlement_id"), company = field(form, "company"), boxfulId = field(form, "boxful_id");
  if (!UUID.test(id) || !UUID.test(boxfulId) || !isCompany(company)) return fail("Liquidación no válida.");
  const { data, error } = await db()
    .from("settlements")
    .update({ boxful_id: null, linked_by: null, linked_at: null, changed_by: auth.user.id })
    .eq("id", id)
    .eq("company", company)
    .eq("boxful_id", boxfulId)
    .select("id");
  if (error) return fail(bankError(error));
  if (!data?.length) return fail("La liquidación cambió. Actualiza la página.");
  return done("Comprobante desvinculado. Si ya estaba conciliado con Mercury, ese cruce se mantiene.");
}

/** Una liquidación rechazada (o fallida) que alguien ya revisó: sale de pendientes. */
export async function reviewSettlement(_prev: BankState, form: FormData): Promise<BankState> {
  const auth = await authorizeAction("reconciliation");
  if (!auth.ok) return auth;
  const id = field(form, "settlement_id"), company = field(form, "company"), note = field(form, "note");
  if (!UUID.test(id) || !isCompany(company)) return fail("Liquidación no válida.");
  if (note.length < 3 || note.length > 500) return fail("Escribe qué pasó, de 3 a 500 caracteres.");
  const { data, error } = await db()
    .from("settlements")
    .update({ reviewed_at: new Date().toISOString(), reviewed_by: auth.user.id, review_note: note, changed_by: auth.user.id })
    .eq("id", id)
    .eq("company", company)
    .eq("status", "rejected")
    .is("reviewed_at", null)
    .select("id");
  if (error) return fail(bankError(error));
  if (!data?.length) return fail("La liquidación ya fue revisada o cambió. Actualiza la página.");
  return done("Marcada como revisada.");
}

/** Comprobante de Boxful que no es una liquidación (p. ej. un pago de bodega): deja de sugerirse. */
export async function exemptBankEntry(_prev: BankState, form: FormData): Promise<BankState> {
  const auth = await authorizeAction("reconciliation");
  if (!auth.ok) return auth;
  const id = field(form, "entry_id"), company = field(form, "company"), reason = field(form, "reason");
  if (!UUID.test(id) || !isCompany(company)) return fail("Comprobante no válido.");
  if (reason.length < 3 || reason.length > 300) return fail("Escribe qué es, de 3 a 300 caracteres.");
  const [entry, linked] = await Promise.all([
    db().from("bank_entries").select("id,source").eq("id", id).eq("company", company).maybeSingle(),
    db().from("settlements").select("id").eq("boxful_id", id).limit(1),
  ]);
  if (entry.error || linked.error) return fail("No se pudo revisar el comprobante. Actualiza la página.");
  if (!entry.data || entry.data.source !== "boxful") return fail("Elige un comprobante de Boxful de esta empresa.");
  if (linked.data?.length) return fail("Ese comprobante está vinculado a una liquidación. Desvincúlalo primero.");
  const { error } = await db().from("settlement_exempt_entries").insert({ entry_id: id, company, reason, created_by: auth.user.id });
  if (error) return fail(error.code === "23505" ? "Ya estaba marcado." : bankError(error));
  return done("Listo: ya no se sugiere como liquidación.");
}

export async function unexemptBankEntry(_prev: BankState, form: FormData): Promise<BankState> {
  const auth = await authorizeAction("reconciliation");
  if (!auth.ok) return auth;
  const id = field(form, "id"), company = field(form, "company");
  if (!UUID.test(id) || !isCompany(company)) return fail("Registro no válido.");
  const { data, error } = await db()
    .from("settlement_exempt_entries")
    .update({ revoked_at: new Date().toISOString(), revoked_by: auth.user.id })
    .eq("id", id)
    .eq("company", company)
    .is("revoked_at", null)
    .select("id");
  if (error) return fail(bankError(error));
  if (!data?.length) return fail("Ya se había quitado. Actualiza la página.");
  return done("Vuelve a sugerirse como liquidación.");
}
