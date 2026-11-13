import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cleanScopes, DEFAULT_SCOPES, type AssistantScope } from "./assistant-scopes";
import { contactLinks, contactsById, storeDirectory } from "./contacts";
import { buildNotices, noticeOrders, PROBLEM_CODE, problemSince, type NoticeGroup, type ProblemOrder, type StoreGroup } from "./problem-notices";
import { db } from "./supabase";

// Avisos de "Problemas en gestión" (lógica en problem-notices.ts) y llaves de los asistentes que los
// leen por MCP. Tablas: supabase/migrations/*_problem_notices.sql.

const missingTable = (e: { code?: string }) => e.code === "42P01" || e.code === "PGRST205";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ─── Avisos ───

/** Pedidos que hoy están en "Problemas en gestión", con su tienda y desde cuándo. */
async function problemOrders(): Promise<ProblemOrder[]> {
  const [orders, accounts, directory] = await Promise.all([
    db().from("orders")
      .select("id, account_id, store_id, dropshipper, external_id, tracking_number, updated_at, timeline:raw->orderInfo->statusTimeline")
      .eq("status_code", PROBLEM_CODE).order("updated_at", { ascending: false }).limit(5000),
    db().from("accounts").select("id, country, enabled"),
    storeDirectory().catch((e) => (console.error("avisos: store_directory", e), [])),
  ]);
  if (orders.error) throw orders.error;
  if (accounts.error) throw accounts.error;
  const country = new Map(((accounts.data ?? []) as { id: string; country: string; enabled: boolean | null }[]).filter((a) => a.enabled !== false).map((a) => [a.id, a.country]));
  const names = new Map(directory.map((s) => [`${s.account_id}|${s.store_id}`, s.name]));
  type Row = { id: string; account_id: string; store_id: string | null; dropshipper: string | null; external_id: string; tracking_number: string | null; updated_at: string; timeline?: unknown; raw?: { orderInfo?: { statusTimeline?: unknown } } };
  const out: ProblemOrder[] = [];
  for (const r of (orders.data ?? []) as unknown as Row[]) {
    const c = country.get(r.account_id);
    if (!c || !r.dropshipper) continue;
    const storeId = r.store_id ?? `name:${r.dropshipper}`;
    out.push({
      id: r.id, account_id: r.account_id, store_id: storeId, store_name: names.get(`${r.account_id}|${storeId}`) ?? r.dropshipper, country: c,
      external_id: r.external_id, tracking_number: r.tracking_number,
      since: problemSince(r.timeline ?? r.raw?.orderInfo?.statusTimeline, r.updated_at),
    });
  }
  return out;
}

/** Contacto de cada tienda ("cuenta|tienda"), con el enlace de su grupo si lo tiene. */
async function storeGroups(): Promise<Map<string, StoreGroup>> {
  const links = await contactLinks();
  const contacts = await contactsById([...new Set(links.map((l) => l.contact_id))]);
  const out = new Map<string, StoreGroup>();
  for (const l of links) {
    const c = contacts.get(l.contact_id);
    if (c) out.set(`${l.account_id}|${l.store_id}`, { contact_id: c.id, group_url: c.whatsapp_group_url, group_code: c.whatsapp_group_code, owner_name: c.owner_name });
  }
  return out;
}

export type IssuedNotice = NoticeGroup & { batch_id: string };
export type NoticesToday = { groups: IssuedNotice[]; missing: IssuedNotice[]; ready: boolean };

/** Id del aviso: el mismo grupo con los mismos pedidos el mismo día es el mismo aviso. */
const batchId = (g: NoticeGroup, day: string) => sha256(`${g.key}|${day}|${noticeOrders(g).map((o) => o.id).sort().join(",")}`).slice(0, 20);

/**
 * Avisos de hoy. Cada uno queda guardado con su id para marcarlo enviado después con exactamente
 * esos pedidos (aunque mientras tanto entre otro pedido al grupo). `ready` es false si falta la migración.
 */
export async function noticesToday(now = Date.now()): Promise<NoticesToday> {
  const [orders, contacts, notices, first] = await Promise.all([
    problemOrders(),
    storeGroups(),
    db().from("problem_notices").select("order_id, last_at").limit(50000),
    db().from("problem_notice_batches").select("sent_at").not("sent_at", "is", null).order("sent_at").limit(1),
  ]);
  if (notices.error) {
    if (missingTable(notices.error)) return { groups: [], missing: [], ready: false };
    throw notices.error;
  }
  if (first.error) throw first.error;
  const notified = new Map(((notices.data ?? []) as { order_id: string; last_at: string }[]).map((n) => [n.order_id, n.last_at]));
  const firstNotice = ((first.data ?? []) as { sent_at: string }[])[0]?.sent_at ?? null;
  const built = buildNotices({ orders, notified, contacts, firstNotice, now });
  const day = new Date(now).toISOString().slice(0, 10);
  const issue = (g: NoticeGroup): IssuedNotice => ({ ...g, batch_id: batchId(g, day) });
  const groups = built.groups.map(issue);
  const missing = built.missing.map(issue);
  const rows = [...groups, ...missing].map((g) => ({
    id: g.batch_id, group_key: g.key, contact_id: g.contact_id, title: g.title, order_ids: noticeOrders(g).map((o) => o.id), message: g.message,
  }));
  if (rows.length) {
    // si ya existe (otra consulta del mismo día), no se toca: así no se borra si ya se marcó enviado
    const { error } = await db().from("problem_notice_batches").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
  }
  return { groups, missing, ready: true };
}

export type MarkResult = { ok: true; title: string; orders: number; already: boolean } | { ok: false; msg: string };

/** Marca enviado un aviso: sus pedidos no se vuelven a avisar hasta el recordatorio. */
export async function markNoticeSent(batch: string, via: "mcp" | "panel", by: string): Promise<MarkResult> {
  if (!/^[0-9a-f]{20}$/.test(batch)) return { ok: false, msg: "Ese aviso_id no es válido: cópialo tal cual de la lista de avisos." };
  const { data, error } = await db().from("problem_notice_batches").select("id, title, order_ids, sent_at").eq("id", batch).maybeSingle();
  if (error) {
    if (missingTable(error)) return { ok: false, msg: "Falta aplicar la migración de avisos." };
    throw error;
  }
  const b = data as { id: string; title: string; order_ids: string[]; sent_at: string | null } | null;
  if (!b) return { ok: false, msg: "No encuentro ese aviso. Vuelve a pedir la lista de avisos de hoy." };
  if (b.sent_at) return { ok: true, title: b.title, orders: b.order_ids.length, already: true };
  const at = new Date().toISOString();
  const upd = await db().from("problem_notice_batches").update({ sent_at: at, sent_via: via, sent_by: by.slice(0, 80) }).eq("id", b.id).is("sent_at", null).select("id");
  if (upd.error) throw upd.error;
  // otro lo marcó al mismo tiempo
  if (!(upd.data ?? []).length) return { ok: true, title: b.title, orders: b.order_ids.length, already: true };
  const prev = await db().from("problem_notices").select("order_id, first_at, times").in("order_id", b.order_ids);
  if (prev.error) throw prev.error;
  const before = new Map(((prev.data ?? []) as { order_id: string; first_at: string; times: number }[]).map((p) => [p.order_id, p]));
  const rows = b.order_ids.map((id) => ({
    order_id: id, first_at: before.get(id)?.first_at ?? at, last_at: at, times: (before.get(id)?.times ?? 0) + 1, batch_id: b.id,
  }));
  const up = await db().from("problem_notices").upsert(rows, { onConflict: "order_id" });
  if (up.error) throw up.error;
  return { ok: true, title: b.title, orders: rows.length, already: false };
}

export type SentNotice = { id: string; title: string; orders: number; sent_at: string; sent_via: string | null; sent_by: string | null };

/** Últimos avisos enviados. */
export async function recentSent(limit = 30): Promise<SentNotice[]> {
  const { data, error } = await db().from("problem_notice_batches").select("id, title, order_ids, sent_at, sent_via, sent_by")
    .not("sent_at", "is", null).order("sent_at", { ascending: false }).limit(limit);
  if (error) {
    if (missingTable(error)) return [];
    throw error;
  }
  return ((data ?? []) as (Omit<SentNotice, "orders"> & { order_ids: string[] })[]).map(({ order_ids, ...r }) => ({ ...r, orders: order_ids.length }));
}

// ─── Llaves de asistentes ───

export type AssistantKey = { id: string; name: string; key_tail: string; scopes: AssistantScope[]; created_at: string; last_used_at: string | null; revoked_at: string | null };
export type AssistantWho = { id: string; name: string; scopes: AssistantScope[] };

const KEY_RE = /^mnv_[A-Za-z0-9_-]{43}$/;

export async function listAssistantKeys(): Promise<AssistantKey[] | null> {
  const { data, error } = await db().from("assistant_keys").select("id, name, key_tail, scopes, created_at, last_used_at, revoked_at").order("created_at", { ascending: false });
  if (error) {
    if (missingTable(error)) return null;
    throw error;
  }
  return ((data ?? []) as AssistantKey[]).map((k) => ({ ...k, scopes: cleanScopes(Array.isArray(k.scopes) ? k.scopes : DEFAULT_SCOPES) }));
}

/** Crea una llave; devuelve la llave completa (se muestra una sola vez; se guarda solo su hash). */
export async function createAssistantKey(name: string, scopes: AssistantScope[], userId: string): Promise<string> {
  const key = `mnv_${randomBytes(32).toString("base64url")}`;
  const { error } = await db().from("assistant_keys").insert({ name, key_hash: sha256(key), key_tail: key.slice(-4), scopes, created_by: userId });
  if (error) throw error;
  return key;
}

export async function revokeAssistantKey(id: string): Promise<void> {
  const { error } = await db().from("assistant_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id).is("revoked_at", null);
  if (error) throw error;
}

/** Qué puede ver una llave. */
export async function setAssistantKeyScopes(id: string, scopes: AssistantScope[]): Promise<void> {
  const { error } = await db().from("assistant_keys").update({ scopes }).eq("id", id).is("revoked_at", null);
  if (error) throw error;
}

/** La llave (nombre y permisos) si es válida y no está revocada; anota cuándo se usó (como mucho cada 10 min). */
export async function verifyAssistantKey(key: string | null): Promise<AssistantWho | null> {
  if (!key || !KEY_RE.test(key)) return null;
  const { data, error } = await db().from("assistant_keys").select("id, name, scopes, revoked_at, last_used_at").eq("key_hash", sha256(key)).maybeSingle();
  if (error) {
    if (missingTable(error)) return null;
    throw error;
  }
  const k = data as { id: string; name: string; scopes: string[] | null; revoked_at: string | null; last_used_at: string | null } | null;
  if (!k || k.revoked_at) return null;
  if (!k.last_used_at || Date.now() - Date.parse(k.last_used_at) > 10 * 60_000) {
    await db().from("assistant_keys").update({ last_used_at: new Date().toISOString() }).eq("id", k.id).then(({ error: e }) => e && console.error("assistant_keys last_used", e));
  }
  return { id: k.id, name: k.name, scopes: cleanScopes(Array.isArray(k.scopes) ? k.scopes : DEFAULT_SCOPES) };
}
