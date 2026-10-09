// Simulación local de los contactos de tiendas (grupo de WhatsApp), de store_directory y de store_profiles.
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

// correos "detectados en los pedidos" inventados; el resto de tiendas queda sin correo
const EMAIL: Record<string, string> = {
  "Velora Honduras": "ventas@velorahn.com", Trendyhaus: "trendyhaus.hn@gmail.com", Nutralix: "nutralixoficial@gmail.com",
  "Noelia Home": "noeliahome.store@gmail.com",
};

function storeProfiles(args: Row, ctx: FixtureCtx) {
  return (storeDirectory(args, ctx) as Row[]).map((s) => {
    const mine = ctx.ORDERS.filter((o) => o.account_id === s.account_id && o.dropshipper && ctx.storeId(o) === s.store_id)
      .filter((o) => ctx.groupOf(o.status_code) !== "cancelled");
    const dates = mine.map((o) => o.ordered_at).sort();
    return {
      account_id: s.account_id, store_id: s.store_id, account_name: s.account_name, country: s.country, name: s.name,
      person: s.person, first_at: dates[0] ?? null, last_at: dates.at(-1) ?? null, orders: mine.length,
      email: s.country === "GT" ? null : EMAIL[s.name] ?? null, email_orders: EMAIL[s.name] ? 5 : null,
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

export const fixtures: FixtureModule = { rpc: { store_directory: storeDirectory, store_profiles: storeProfiles }, tables: { store_contacts, store_contact_links } };
