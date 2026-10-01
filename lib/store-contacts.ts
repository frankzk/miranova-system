// Contactos de tiendas (grupo de WhatsApp, teléfono y responsable del dueño) y sugerencias para
// vincular la misma tienda en otras operaciones. Solo lógica sin base de datos, para probarla.
// Tablas y directorio: supabase/migrations/0019_store_contacts.sql.

export type StoreContact = {
  id: string;
  whatsapp_group_url: string | null;
  whatsapp_group_code: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  /** Correo de la tienda cargado a mano (migración 0024); tiene prioridad sobre el detectado. */
  email?: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ContactLink = { account_id: string; store_id: string; contact_id: string; store_name: string | null };

/** Una tienda de cualquier cuenta (función `store_directory`). */
export type DirectoryStore = {
  account_id: string;
  store_id: string;
  account_name: string;
  country: string;
  name: string;
  /** Responsable que informa la plataforma (Drop: seller.lastName). */
  person: string | null;
  last_at: string | null;
  orders90: number;
};

const CODE = /^[A-Za-z0-9]{16,40}$/;

/**
 * Enlace de invitación a un grupo: acepta "https://chat.whatsapp.com/<código>", sin https,
 * con "/invite/" o con parámetros (?mode=…). Devuelve el enlace limpio y el código, o null.
 */
export function parseWhatsappGroup(input: string): { url: string; code: string } | null {
  const raw = input.trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (u.hostname.toLowerCase() !== "chat.whatsapp.com") return null;
  const parts = u.pathname.split("/").filter(Boolean);
  const code = parts[0]?.toLowerCase() === "invite" ? parts[1] : parts[0];
  if (!code || !CODE.test(code) || parts.length > (parts[0]?.toLowerCase() === "invite" ? 2 : 1)) return null;
  return { url: `https://chat.whatsapp.com/${code}`, code };
}

/** Código telefónico de los países donde opera Miranova. */
export const DIAL: Record<string, string> = { HN: "504", GT: "502", SV: "503", CR: "506", NI: "505", PA: "507" };

/**
 * Teléfono en dígitos con código de país. Un número local de 8 dígitos toma el código del
 * país de la cuenta. Devuelve null si no parece un teléfono.
 */
export function normalizePhone(input: string, country: string): string | null {
  const digits = input.replace(/[^\d]/g, "").replace(/^00/, "");
  if (!digits) return null;
  const dial = DIAL[country];
  const full = digits.length === 8 && dial && !input.trim().startsWith("+") ? dial + digits : digits;
  return full.length >= 10 && full.length <= 15 ? full : null;
}

/** "+504 9999 8888" para mostrar. */
export function formatPhone(phone: string): string {
  const dial = Object.values(DIAL).find((d) => phone.startsWith(d) && phone.length === d.length + 8);
  if (dial) {
    const n = phone.slice(dial.length);
    return `+${dial} ${n.slice(0, 4)} ${n.slice(4)}`;
  }
  return `+${phone}`;
}

export const whatsappChat = (phone: string) => `https://wa.me/${phone}`;

/** Minúsculas, sin tildes y con espacios simples. */
export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// palabras que no distinguen a una tienda de otra
const GENERIC = new Set([
  "hn", "gt", "sv", "cr", "ni", "pa", "honduras", "guatemala", "salvador", "costa", "rica", "nicaragua", "panama",
  "el", "la", "los", "las", "de", "del", "y", "en", "store", "tienda", "tiendas", "shop", "oficial", "online", "linea",
  "market", "mart", "express", "plus", "center", "centro", "mas", "co", "sa",
]);

/** Palabras que identifican el nombre de una tienda ("Velora Store Salvador" → ["velora"]). */
export function nameTokens(name: string): string[] {
  return norm(name).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !GENERIC.has(t));
}

export type Suggestion = {
  store: DirectoryStore;
  /** same_person: mismo responsable en la plataforma. similar_name: nombre parecido. */
  reason: "same_person" | "similar_name";
  /** El nombre se parece pero la plataforma informa otro responsable: probablemente otra tienda. */
  other_person: boolean;
  /** Contacto que ya tiene esa tienda (si tiene). */
  contact_id: string | null;
};

const key = (s: { account_id: string; store_id: string }) => `${s.account_id}|${s.store_id}`;

/**
 * Tiendas de otras operaciones que podrían ser del mismo dueño que `self`: primero las del
 * mismo responsable, luego las de nombre parecido (avisando si el responsable es otro).
 * Se omiten las que ya están en el mismo contacto.
 */
export function suggestLinks(self: DirectoryStore, all: DirectoryStore[], links: ContactLink[], max = 6): Suggestion[] {
  const contactOf = new Map(links.map((l) => [key(l), l.contact_id]));
  const mine = contactOf.get(key(self)) ?? null;
  const person = self.person ? norm(self.person) : "";
  const tokens = new Set(nameTokens(self.name));
  const out: Suggestion[] = [];
  for (const s of all) {
    if (key(s) === key(self)) continue;
    const contact = contactOf.get(key(s)) ?? null;
    if (mine && contact === mine) continue;
    const theirs = s.person ? norm(s.person) : "";
    const samePerson = person.length >= 5 && theirs === person;
    const similar = nameTokens(s.name).some((t) => tokens.has(t));
    if (!samePerson && !similar) continue;
    out.push({
      store: s,
      reason: samePerson ? "same_person" : "similar_name",
      other_person: !samePerson && !!person && !!theirs,
      contact_id: contact,
    });
  }
  const rank = (x: Suggestion) => (x.reason === "same_person" ? 0 : x.other_person ? 2 : 1);
  return out
    .sort((a, b) => rank(a) - rank(b) || (b.store.last_at ?? "").localeCompare(a.store.last_at ?? ""))
    .slice(0, max);
}

/** Correo válido en minúsculas, o null. */
export function normalizeEmail(input: string): string | null {
  const v = input.trim().toLowerCase();
  return v.length <= 200 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null;
}

/**
 * Correo de la tienda: el cargado en su contacto o, si no hay, el detectado en los pedidos
 * (función store_profiles). `source` dice de dónde salió, para mostrarlo.
 */
export function storeEmail(manual: string | null | undefined, detected: string | null | undefined): { email: string; source: "contacto" | "pedidos" } | null {
  if (manual?.trim()) return { email: manual.trim(), source: "contacto" };
  if (detected?.trim()) return { email: detected.trim(), source: "pedidos" };
  return null;
}
