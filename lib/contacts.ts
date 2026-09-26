import "server-only";
import { db } from "./supabase";
import { suggestLinks, type ContactLink, type DirectoryStore, type StoreContact, type Suggestion } from "./store-contacts";

export type { ContactLink, DirectoryStore, StoreContact, Suggestion } from "./store-contacts";

/** Todas las tiendas de todas las cuentas (nombre y responsable más recientes). */
export async function storeDirectory(): Promise<DirectoryStore[]> {
  const { data, error } = await db().rpc("store_directory");
  if (error) throw error;
  return ((data ?? []) as DirectoryStore[]).map((s) => ({ ...s, orders90: Number(s.orders90) }));
}

export async function contactLinks(): Promise<ContactLink[]> {
  const { data, error } = await db().from("store_contact_links").select("account_id, store_id, contact_id, store_name");
  if (error) throw error;
  return (data ?? []) as ContactLink[];
}

export async function contactsById(ids: string[]): Promise<Map<string, StoreContact>> {
  if (!ids.length) return new Map();
  const { data, error } = await db().from("store_contacts").select("*").in("id", ids);
  if (error) throw error;
  return new Map(((data ?? []) as StoreContact[]).map((c) => [c.id, c]));
}

const key = (s: { account_id: string; store_id: string }) => `${s.account_id}|${s.store_id}`;

export type StoreContactView = {
  self: DirectoryStore | null;
  contact: StoreContact | null;
  /** Las demás tiendas del mismo contacto (sin esta). */
  siblings: (ContactLink & { store: DirectoryStore | null })[];
  suggestions: Suggestion[];
};

/** Contacto de una tienda, las otras operaciones del mismo dueño y sugerencias para vincular. */
export async function storeContactView(accountId: string, storeId: string): Promise<StoreContactView> {
  const [directory, links] = await Promise.all([storeDirectory(), contactLinks()]);
  const self = directory.find((s) => s.account_id === accountId && s.store_id === storeId) ?? null;
  const mine = links.find((l) => l.account_id === accountId && l.store_id === storeId);
  const contact = mine ? (await contactsById([mine.contact_id])).get(mine.contact_id) ?? null : null;
  const byKey = new Map(directory.map((s) => [key(s), s]));
  const siblings = mine
    ? links
        .filter((l) => l.contact_id === mine.contact_id && key(l) !== key(mine))
        .map((l) => ({ ...l, store: byKey.get(key(l)) ?? null }))
    : [];
  return { self, contact, siblings, suggestions: self ? suggestLinks(self, directory, links) : [] };
}

/** Por tienda (cuenta|store_id): enlace del grupo y teléfono, para los listados. */
export async function contactIndex(): Promise<Map<string, { group: string | null; phone: string | null }>> {
  const links = await contactLinks();
  const contacts = await contactsById([...new Set(links.map((l) => l.contact_id))]);
  const out = new Map<string, { group: string | null; phone: string | null }>();
  for (const l of links) {
    const c = contacts.get(l.contact_id);
    if (c) out.set(key(l), { group: c.whatsapp_group_url, phone: c.owner_phone });
  }
  return out;
}

export const contactKey = key;
