import "server-only";
import { memo } from "./memo";
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

/** Una tienda con su ingreso, dueño y correo detectado (función `store_profiles`, migración 0024). */
export type StoreProfile = {
  account_id: string;
  store_id: string;
  account_name: string;
  country: string;
  name: string;
  /** Dueño según Drop (seller.lastName). */
  person: string | null;
  /** Primer pedido con Miranova: el ingreso de la tienda. */
  first_at: string;
  last_at: string;
  orders: number;
  /** Correo repetido en pedidos de 3+ clientes distintos: el de la tienda. */
  email: string | null;
};

/** Perfiles de todas las tiendas (recorre todos los pedidos: memoria de 1 minuto). */
export function storeProfiles(): Promise<StoreProfile[]> {
  return memo("store_profiles", 60_000, async () => {
    const { data, error } = await db().rpc("store_profiles");
    if (error) throw error;
    return ((data ?? []) as StoreProfile[]).map((p) => ({ ...p, orders: Number(p.orders) }));
  });
}

export type StoreContactView = {
  self: DirectoryStore | null;
  /** Correo detectado en los pedidos de esta tienda (null si no se detecta). */
  detectedEmail: string | null;
  contact: StoreContact | null;
  /** Las demás tiendas del mismo contacto (sin esta). */
  siblings: (ContactLink & { store: DirectoryStore | null })[];
  suggestions: Suggestion[];
};

/** Contacto de una tienda, las otras operaciones del mismo dueño y sugerencias para vincular. */
export async function storeContactView(accountId: string, storeId: string): Promise<StoreContactView> {
  // el directorio recorre todos los pedidos (~0.2 s): memoria de 1 minuto; los contactos, siempre al día
  // el correo detectado es un extra: si su consulta falla, el panel se muestra igual
  const profilesOrNone = storeProfiles().catch((e) => {
    console.error("store_profiles", e);
    return [] as StoreProfile[];
  });
  const [directory, links, profiles] = await Promise.all([memo("store_directory", 60_000, storeDirectory), contactLinks(), profilesOrNone]);
  const self = directory.find((s) => s.account_id === accountId && s.store_id === storeId) ?? null;
  const mine = links.find((l) => l.account_id === accountId && l.store_id === storeId);
  const contact = mine ? (await contactsById([mine.contact_id])).get(mine.contact_id) ?? null : null;
  const byKey = new Map(directory.map((s) => [key(s), s]));
  const siblings = mine
    ? links
        .filter((l) => l.contact_id === mine.contact_id && key(l) !== key(mine))
        .map((l) => ({ ...l, store: byKey.get(key(l)) ?? null }))
    : [];
  const detectedEmail = profiles.find((p) => p.account_id === accountId && p.store_id === storeId)?.email ?? null;
  return { self, detectedEmail, contact, siblings, suggestions: self ? suggestLinks(self, directory, links) : [] };
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

/**
 * Contacto completo de cada tienda (cuenta|tienda) y las otras tiendas del mismo contacto,
 * para exportar el listado.
 */
export async function contactsByStore(): Promise<Map<string, StoreContact & { others: string[] }>> {
  const links = await contactLinks();
  const contacts = await contactsById([...new Set(links.map((l) => l.contact_id))]);
  const out = new Map<string, StoreContact & { others: string[] }>();
  for (const l of links) {
    const c = contacts.get(l.contact_id);
    if (!c) continue;
    const others = links.filter((x) => x.contact_id === l.contact_id && key(x) !== key(l)).map((x) => x.store_name ?? x.store_id);
    out.set(key(l), { ...c, others });
  }
  return out;
}
