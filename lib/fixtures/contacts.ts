// Simulación local de los contactos de tiendas (grupo de WhatsApp) y de store_directory.
import type { FixtureCtx, FixtureModule, Row } from "./types";

// responsables inventados; en Guatemala "Nutralix" es de otra persona (nombre igual, otro dueño)
const PERSON: Record<string, string> = {
  "Velora Honduras": "Ana Pérez", ZONAHN: "Luis Mejía", Trendyhaus: "Carla Ruiz",
  Nutralix: "Mario López", "Noelia Home": "Noelia Castro", "MercaGo HN": "Jorge Díaz",
};
const personOf = (name: string, country: string) => (country === "GT" && name === "Nutralix" ? "Sofía Morales" : PERSON[name] ?? null);

function storeDirectory(_args: Row, { ORDERS, ACCOUNTS, DAY, groupOf, storeId }: FixtureCtx) {
  const by = new Map<string, Row[]>();
  for (const o of ORDERS) {
    if (!o.dropshipper) continue;
    const k = `${o.account_id}|${storeId(o)}`;
    by.set(k, [...(by.get(k) ?? []), o]);
  }
  return [...by.values()].map((rows) => {
    const acc = ACCOUNTS.find((a) => a.id === rows[0].account_id)!;
    const last = rows.map((o) => o.ordered_at).sort().at(-1);
    return {
      account_id: acc.id, store_id: storeId(rows[0]), account_name: acc.name, country: acc.country, name: rows[0].dropshipper,
      person: personOf(rows[0].dropshipper, acc.country), last_at: last,
      orders90: rows.filter((o) => Date.now() - Date.parse(o.ordered_at) <= 90 * DAY && groupOf(o.status_code) !== "cancelled").length,
    };
  });
}

const HN = "11111111-1111-4111-8111-111111111111";
const now = new Date().toISOString();
const store_contacts: Row[] = [
  {
    id: "c0000000-0000-4000-8000-000000000001", whatsapp_group_url: "https://chat.whatsapp.com/DemoGrupoZonaHn0000001",
    whatsapp_group_code: "DemoGrupoZonaHn0000001", owner_name: "Luis Mejía", owner_phone: "50499990000",
    notes: "Responde por la tarde", created_at: now, updated_at: now,
  },
];
const store_contact_links: Row[] = [
  { account_id: HN, store_id: "name:ZONAHN", contact_id: store_contacts[0].id, store_name: "ZONAHN", created_at: now },
];

export const fixtures: FixtureModule = { rpc: { store_directory: storeDirectory }, tables: { store_contacts, store_contact_links } };
