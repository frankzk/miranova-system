// Avisos de "Problemas en gestión" a cada tienda por su grupo de WhatsApp: qué pedidos van en el aviso
// de hoy y el texto del mensaje (como lo escribe el equipo). Sin base de datos ni Next, para probarlo.
//   · Nuevo: el pedido entró a "Problemas en gestión" y todavía no se avisó (o volvió a entrar después
//     del último aviso). Cuentan los que entraron desde 3 días antes del primer aviso que se marcó
//     enviado: lo de antes ya lo venía avisando el equipo a mano.
//   · Recordatorio: se avisó hace 3 días o más y sigue igual.
//   · Pasados 30 días en ese estado, el pedido ya no se avisa más.
// Las tiendas del mismo contacto (mismo dueño en varios países) comparten grupo: un solo mensaje.

import { countryByCode } from "./countries.ts";

export const PROBLEM_CODE = "6";
export const REMIND_DAYS = 3;
export const WINDOW_DAYS = 30;
export const FIRST_DAYS = 3;
const DAY = 86_400_000;
/** Holgura para que un aviso diario a una hora parecida no se corra un día. */
const SLACK = 6 * 3_600_000;
/**
 * Solo cuenta como que "volvió a entrar" si entró más de una hora después del último aviso: el reloj de
 * Drop puede ir unos minutos adelantado y el aviso no debe repetirse por eso.
 */
const REENTRY = 3_600_000;

export type ProblemOrder = {
  id: string;
  account_id: string;
  store_id: string;
  store_name: string;
  country: string;
  external_id: string;
  tracking_number: string | null;
  /** Cuándo entró a "Problemas en gestión" (ISO). */
  since: string;
};

/** Contacto de la tienda (con o sin enlace del grupo). */
export type StoreGroup = { contact_id: string; group_url: string | null; group_code: string | null; owner_name: string | null };

export type NoticeStore = { account_id: string; store_id: string; name: string; country: string };

export type NoticeGroup = {
  /** "c:<contacto>" o "s:<cuenta>|<tienda>" si la tienda no tiene contacto. */
  key: string;
  contact_id: string | null;
  title: string;
  stores: NoticeStore[];
  owner_name: string | null;
  group_url: string | null;
  /** Abre el grupo directo en WhatsApp Web (si quien lo abre ya está en el grupo). */
  web_url: string | null;
  fresh: ProblemOrder[];
  reminders: ProblemOrder[];
  message: string;
};

const storeKey = (o: { account_id: string; store_id: string }) => `${o.account_id}|${o.store_id}`;

/** Momento en que entró (la última vez) a "Problemas en gestión", según la línea de tiempo de Drop. */
export function problemSince(timeline: unknown, fallback: string): string {
  let best: number | null = null;
  if (Array.isArray(timeline)) {
    for (const e of timeline as { status?: unknown; label?: unknown; occurredAt?: unknown }[]) {
      if (!e || (String(e.status ?? "") !== PROBLEM_CODE && !/problemas en gesti[oó]n/i.test(String(e.label ?? "")))) continue;
      const t = Date.parse(String(e.occurredAt ?? ""));
      if (Number.isFinite(t) && (best === null || t > best)) best = t;
    }
  }
  return best === null ? fallback : new Date(best).toISOString();
}

/** "https://chat.whatsapp.com/ABC…" → enlace que abre ese grupo en WhatsApp Web. */
export const webGroupUrl = (code: string | null) => (code ? `https://web.whatsapp.com/accept?code=${encodeURIComponent(code)}` : null);

/** Primer nombre para el saludo ("diego gómez" → "Diego"); null si no parece un nombre. */
export function greetingName(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  if (!/^[\p{L}][\p{L}'-]{1,29}$/u.test(first)) return null;
  return first.charAt(0).toLocaleUpperCase("es") + first.slice(1).toLocaleLowerCase("es");
}

const countryName = (code: string) => countryByCode(code)?.name ?? code;

function orderLines(list: ProblemOrder[], multiStore: boolean): string[] {
  const out: string[] = [];
  let store = "";
  for (const o of list) {
    const k = storeKey(o);
    if (multiStore && k !== store) {
      store = k;
      out.push(`*${o.store_name}* (${countryName(o.country)})`);
    }
    out.push(`📦 Pedido: ${o.external_id}`, `📄 Guía: ${o.tracking_number || "sin guía"}`, "");
  }
  return out;
}

/** Texto del aviso, con la plantilla del equipo. */
export function noticeMessage(g: { owner_name: string | null; stores: NoticeStore[]; fresh: ProblemOrder[]; reminders: ProblemOrder[] }): string {
  const name = greetingName(g.owner_name);
  const multi = new Set(g.stores.map(storeKey)).size > 1;
  const lines = [`¡Hola${name ? `, ${name}` : ""}! Buen día, ¿cómo estás? 😊`];
  if (g.fresh.length) {
    lines.push(`Te compartimos tus pedidos que presentan *Problemas en gestión* para que puedas revisarlos y avanzar con su despacho. 📦`, "");
    lines.push(...orderLines(g.fresh, multi));
    if (g.reminders.length) lines.push(`⏰ Y estos siguen con *Problemas en gestión* desde el último aviso:`, "", ...orderLines(g.reminders, multi));
  } else {
    lines.push(`Te recordamos estos pedidos que siguen con *Problemas en gestión*, para que puedas revisarlos y avanzar con su despacho. 📦`, "");
    lines.push(...orderLines(g.reminders, multi));
  }
  lines.push("¡Cualquier cosa, estamos aquí para apoyarte! 💙");
  return lines.join("\n");
}

/**
 * Avisos de hoy, uno por grupo: los de tiendas con grupo de WhatsApp en `groups` y los que no tienen
 * enlace en `missing` (para mandarlos a mano o cargar el grupo).
 */
export function buildNotices(input: {
  orders: readonly ProblemOrder[];
  /** Último aviso de cada pedido (id → ISO). */
  notified: ReadonlyMap<string, string>;
  /** Contacto por tienda ("cuenta|tienda"). */
  contacts: ReadonlyMap<string, StoreGroup>;
  /** Primer aviso que se marcó enviado (ISO) o null si nunca. */
  firstNotice: string | null;
  now: number;
}): { groups: NoticeGroup[]; missing: NoticeGroup[] } {
  const { now } = input;
  const windowFrom = now - WINDOW_DAYS * DAY;
  const start = input.firstNotice ? Math.min(Date.parse(input.firstNotice), now) : now;
  const newFrom = Math.max(windowFrom, start - FIRST_DAYS * DAY);
  const by = new Map<string, NoticeGroup>();
  for (const o of input.orders) {
    // una fecha "en el futuro" (reloj de Drop adelantado) cuenta como ahora
    const since = Math.min(Date.parse(o.since), now);
    if (!Number.isFinite(since) || since < windowFrom) continue;
    const last = input.notified.get(o.id);
    const lastAt = last ? Date.parse(last) : NaN;
    let kind: "fresh" | "reminders" | null = null;
    if (!Number.isFinite(lastAt) || since > lastAt + REENTRY) kind = since >= newFrom ? "fresh" : null;
    else if (now - lastAt >= REMIND_DAYS * DAY - SLACK) kind = "reminders";
    if (!kind) continue;
    const contact = input.contacts.get(storeKey(o)) ?? null;
    const key = contact ? `c:${contact.contact_id}` : `s:${storeKey(o)}`;
    let g = by.get(key);
    if (!g) {
      g = {
        key, contact_id: contact?.contact_id ?? null, title: "", stores: [], owner_name: contact?.owner_name ?? null,
        group_url: contact?.group_url ?? null, web_url: webGroupUrl(contact?.group_code ?? null), fresh: [], reminders: [], message: "",
      };
      by.set(key, g);
    }
    if (!g.stores.some((s) => storeKey(s) === storeKey(o))) g.stores.push({ account_id: o.account_id, store_id: o.store_id, name: o.store_name, country: o.country });
    g[kind].push(o);
  }
  const bySince = (a: ProblemOrder, b: ProblemOrder) =>
    a.country.localeCompare(b.country) || a.store_name.localeCompare(b.store_name, "es") || a.since.localeCompare(b.since) || a.external_id.localeCompare(b.external_id);
  const all = [...by.values()].map((g) => {
    g.fresh.sort(bySince);
    g.reminders.sort(bySince);
    g.stores.sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name, "es"));
    g.title = g.stores.map((s) => s.name).filter((n, i, a) => a.indexOf(n) === i).join(" · ");
    g.message = noticeMessage(g);
    return g;
  });
  all.sort((a, b) => a.stores[0].country.localeCompare(b.stores[0].country) || a.title.localeCompare(b.title, "es"));
  return { groups: all.filter((g) => g.group_url), missing: all.filter((g) => !g.group_url) };
}

/** Pedidos de un aviso (nuevos y recordatorios). */
export const noticeOrders = (g: Pick<NoticeGroup, "fresh" | "reminders">) => [...g.fresh, ...g.reminders];
