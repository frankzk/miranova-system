"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth";
import { db } from "@/lib/supabase";
import {
  BANK_BUCKET,
  MAX_BANK_PDF,
  UUID,
  cents,
  cleanBankFields,
  isCompany,
  matchProblem,
  type BankEntry,
  type BankState,
} from "@/lib/reconciliation";
import { bankError } from "@/lib/reconciliation-data";

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const fail = (msg: string) => ({ ok: false as const, msg });
const done = (msg: string) => {
  revalidatePath("/reconciliation");
  return { ok: true as const, msg };
};

export async function prepareBankPdf(
  company: string,
  name: string,
  size: number,
) {
  const auth = await authorizeAction("reconciliation");
  if (!auth.ok) return auth;
  if (
    !isCompany(company) ||
    !name.toLowerCase().endsWith(".pdf") ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > MAX_BANK_PDF
  )
    return fail("Adjunta un PDF de hasta 15 MB.");
  const path = `${company}/${auth.user.id}/${crypto.randomUUID()}.pdf`;
  const { data, error } = await db()
    .storage.from(BANK_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) return fail("No se pudo preparar la carga del PDF.");
  return { ok: true as const, path, url: data.signedUrl };
}

export async function saveBankEntry(
  _prev: BankState,
  form: FormData,
): Promise<BankState> {
  const auth = await authorizeAction("reconciliation");
  if (!auth.ok) return auth;
  const input = Object.fromEntries(
    [
      "company",
      "source",
      "reference",
      "occurred_on",
      "amount",
      "original_currency",
      "original_amount",
      "counterparty",
      "bank_account",
      "notes",
    ].map((k) => [k, field(form, k)]),
  );
  const clean = cleanBankFields(input);
  if (!clean.ok) return clean;
  const id = field(form, "id");
  if (id) {
    const version = Number(field(form, "version"));
    if (!UUID.test(id) || !Number.isSafeInteger(version) || version < 1)
      return fail("Registro no válido.");
    const { data, error } = await db()
      .from("bank_entries")
      .update({ ...clean.row, version: version + 1, updated_by: auth.user.id })
      .eq("id", id)
      .eq("company", clean.row.company)
      .eq("source", clean.row.source)
      .eq("version", version)
      .select("id");
    if (error) return fail(bankError(error));
    if (!data?.length)
      return fail(
        "El registro cambió o ya no existe. Actualiza y revisa los datos.",
      );
    return done("Movimiento actualizado.");
  }
  let document:
    | { document_path: string; document_name: string; document_sha256: string }
    | object = {};
  if (clean.row.source === "boxful") {
    const path = field(form, "document_path");
    const name = field(form, "document_name");
    const prefix = `${clean.row.company}/${auth.user.id}/`;
    if (
      !path.startsWith(prefix) ||
      !UUID.test(path.slice(prefix.length, -4)) ||
      !path.endsWith(".pdf") ||
      !name ||
      name.length > 200
    )
      return fail("Adjunta el PDF de Boxful antes de guardar.");
    const { data: info, error: infoErr } = await db()
      .storage.from(BANK_BUCKET)
      .info(path);
    if (
      infoErr ||
      !info ||
      !info.size ||
      info.size > MAX_BANK_PDF ||
      info.contentType !== "application/pdf"
    )
      return fail("El PDF no se cargó correctamente o supera 15 MB.");
    const { data: file, error: readErr } = await db()
      .storage.from(BANK_BUCKET)
      .download(path);
    if (readErr || !file) return fail("No se pudo verificar el PDF.");
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-")
      return fail("El archivo no es un PDF válido.");
    document = {
      document_path: path,
      document_name: name,
      document_sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }
  const { error } = await db()
    .from("bank_entries")
    .insert({
      ...clean.row,
      ...document,
      version: 1,
      created_by: auth.user.id,
      updated_by: auth.user.id,
    });
  if (error) return fail(bankError(error));
  return done("Movimiento registrado. Ya puedes revisarlo para conciliar.");
}

export async function reconcileBank(
  _prev: BankState,
  form: FormData,
): Promise<BankState> {
  const auth = await authorizeAction("reconciliation");
  if (!auth.ok) return auth;
  if (field(form, "confirmed") !== "on")
    return fail("Confirma que verificaste la transferencia y su comisión.");
  const company = field(form, "company"),
    boxfulId = field(form, "boxful_id"),
    mercuryId = field(form, "mercury_id");
  const fee = cents(field(form, "fee")),
    fee_note = field(form, "fee_note");
  if (
    !isCompany(company) ||
    !UUID.test(boxfulId) ||
    !UUID.test(mercuryId) ||
    fee === null ||
    fee_note.length > 1000
  )
    return fail("Revisa los movimientos y la comisión.");
  const versions = [
    Number(field(form, "boxful_version")),
    Number(field(form, "mercury_version")),
  ];
  if (versions.some((v) => !Number.isSafeInteger(v) || v < 1))
    return fail("Actualiza la página y revisa los movimientos.");
  const { data, error } = await db()
    .from("bank_entries")
    .select("*")
    .eq("company", company)
    .in("id", [boxfulId, mercuryId]);
  if (error) return fail(bankError(error));
  const b = data?.find((e) => e.id === boxfulId) as BankEntry | undefined;
  const m = data?.find((e) => e.id === mercuryId) as BankEntry | undefined;
  if (!b || !m)
    return fail("No se encontraron ambos movimientos en esta empresa.");
  const problem = matchProblem(b, m, fee, fee_note);
  if (problem) return fail(problem);
  if (b.version !== versions[0] || m.version !== versions[1])
    return fail("Los movimientos cambiaron. Actualiza y revisa los importes.");
  const { error: writeErr } = await db()
    .from("bank_matches")
    .insert({
      company,
      boxful_id: boxfulId,
      mercury_id: mercuryId,
      boxful_version: versions[0],
      mercury_version: versions[1],
      boxful_snapshot: b,
      mercury_snapshot: m,
      fee_cents: fee,
      fee_note,
      created_by: auth.user.id,
    });
  if (writeErr) return fail(bankError(writeErr));
  return done(
    "Conciliación confirmada. Ambos movimientos quedaron vinculados 1:1.",
  );
}

export async function reverseBankMatch(
  _prev: BankState,
  form: FormData,
): Promise<BankState> {
  const auth = await authorizeAction("reconciliation");
  if (!auth.ok) return auth;
  const id = field(form, "id"),
    reason = field(form, "reason"),
    company = field(form, "company");
  if (
    !UUID.test(id) ||
    !isCompany(company) ||
    reason.length < 3 ||
    reason.length > 500
  )
    return fail("Escribe un motivo de 3 a 500 caracteres.");
  const { data, error } = await db()
    .from("bank_matches")
    .update({
      reversed_at: new Date().toISOString(),
      reversed_by: auth.user.id,
      reversal_reason: reason,
    })
    .eq("id", id)
    .eq("company", company)
    .is("reversed_at", null)
    .select("id");
  if (error) return fail(bankError(error));
  if (!data?.length)
    return fail("La conciliación ya fue revertida o no existe.");
  return done(
    "Conciliación revertida. Los movimientos vuelven a pendientes y se conserva el historial.",
  );
}

export async function voidBankEntry(
  _prev: BankState,
  form: FormData,
): Promise<BankState> {
  const auth = await authorizeAction("reconciliation");
  if (!auth.ok) return auth;
  const id = field(form, "id"),
    reason = field(form, "reason"),
    company = field(form, "company"),
    version = Number(field(form, "version"));
  if (
    !UUID.test(id) ||
    !isCompany(company) ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    reason.length < 3 ||
    reason.length > 500
  )
    return fail("Escribe un motivo de 3 a 500 caracteres.");
  const { data, error } = await db()
    .from("bank_entries")
    .update({
      void_reason: reason,
      version: version + 1,
      updated_by: auth.user.id,
    })
    .eq("id", id)
    .eq("company", company)
    .eq("version", version)
    .is("void_reason", null)
    .select("id");
  if (error) return fail(bankError(error));
  if (!data?.length) return fail("El movimiento cambió. Actualiza la página.");
  return done(
    "Movimiento anulado. Sus datos y su PDF se conservan en el historial.",
  );
}
