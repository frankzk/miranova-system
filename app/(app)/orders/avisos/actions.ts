"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth";
import { markNoticeSent } from "@/lib/problem-notices-data";

// Órdenes › Avisos a tiendas: marcar enviado un aviso mandado a mano (si Grok no lo mandó).

export type NoticeFormState = { ok: boolean; msg: string } | null;

export async function markNoticeAction(_prev: NoticeFormState, form: FormData): Promise<NoticeFormState> {
  const auth = await authorizeAction("orders");
  if (!auth.ok) return auth;
  const r = await markNoticeSent(String(form.get("batch") ?? "").trim(), "panel", auth.user.name);
  if (!r.ok) return { ok: false, msg: r.msg };
  revalidatePath("/orders/avisos");
  return { ok: true, msg: r.already ? "Ya estaba marcado como enviado." : "Marcado como enviado." };
}
