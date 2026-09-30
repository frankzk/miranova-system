import { NextResponse, type NextRequest } from "next/server";
import { authorizeRoute } from "@/lib/auth";
import { listAccounts } from "@/lib/accounts";
import { contactKey, contactsByStore, storeDirectory } from "@/lib/contacts";
import { followupIndex } from "@/lib/followups";
import { storeHealth } from "@/lib/queries";
import { getScope } from "@/lib/scope";
import { formatPhone, whatsappChat } from "@/lib/store-contacts";
import { storeHref } from "@/lib/store-links";
import type { FollowupSummary } from "@/lib/store-metrics";
import {
  applyStoreFilters, change, classify, deliveryRate, filterStores, HEALTH, opportunities, parseStoreFilters, typicalTickets,
} from "@/lib/stores";
import { buildXlsx, XLSX_TYPE, type Cell } from "@/lib/xlsx";

// Exporta Salud de tiendas a Excel con los mismos filtros y orden de la página, más el contacto
// completo y el seguimiento de cada tienda. Una segunda hoja lista las tiendas que ya trabajaron
// con Miranova pero no tienen ventas en los últimos 60 días (no salen en el listado).

const round = (n: number | null | undefined, d = 0) => (n === null || n === undefined || !Number.isFinite(n) ? null : Number(n.toFixed(d)));

/** "2026-09-28 14:05" en la zona de la cuenta. */
function localTime(iso: string | null | undefined, tz: string): string | null {
  if (!iso) return null;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

const CONTACT_HEADERS = [
  { header: "Responsable", width: 22 },
  { header: "Responsable según Drop", width: 22 },
  { header: "Teléfono del dueño", width: 18 },
  { header: "WhatsApp del dueño", width: 28 },
  { header: "Grupo de WhatsApp", width: 44 },
  { header: "Notas del contacto", width: 36 },
  { header: "También atiende", width: 30 },
  { header: "Registros de seguimiento", width: 14 },
  { header: "Último seguimiento", width: 14 },
  { header: "Responsable del último seguimiento", width: 22 },
  { header: "Seguimientos abiertos", width: 12 },
  { header: "Próximo seguimiento", width: 14 },
  { header: "Ficha en el panel", width: 40 },
  { header: "ID de la tienda en Drop", width: 26 },
];

export async function GET(req: NextRequest) {
  const user = await authorizeRoute("stores", "export");
  if (user instanceof Response) return user;
  const accounts = await listAccounts();
  const scope = await getScope(accounts);
  const tzOf = new Map(accounts.map((a) => [a.id, a.timezone]));

  const params: Record<string, string | string[]> = {};
  for (const k of new Set(req.nextUrl.searchParams.keys())) params[k] = req.nextUrl.searchParams.getAll(k);
  const f = parseStoreFilters(params);

  const [all, contacts, directory, followups] = await Promise.all([storeHealth(scope.account), contactsByStore(), storeDirectory(), followupIndex(scope.account)]);
  const person = new Map(directory.map((d) => [contactKey(d), d.person]));
  const hasGroup = (s: { account_id: string; store_id: string }) => !!contacts.get(contactKey(s))?.whatsapp_group_url;
  const origin = req.nextUrl.origin;

  const contactCells = (s: { account_id: string; store_id: string }): Cell[] => {
    const k = contactKey(s);
    const c = contacts.get(k);
    const fu: FollowupSummary | undefined = followups.get(k);
    return [
      c?.owner_name || person.get(k) || null,
      person.get(k) ?? null,
      c?.owner_phone ? formatPhone(c.owner_phone) : null,
      c?.owner_phone ? whatsappChat(c.owner_phone) : null,
      c?.whatsapp_group_url ?? null,
      c?.notes ?? null,
      c?.others.length ? c.others.join(", ") : null,
      fu?.count ?? 0,
      fu?.last ?? null,
      fu?.lastOwner ?? null,
      fu?.open ?? 0,
      fu?.next ?? null,
      `${origin}${storeHref(s.account_id, s.store_id)}`,
      s.store_id,
    ];
  };

  // hoja 1: el listado, tal como se ve
  const rows = applyStoreFilters(all, f, hasGroup);
  const typical = typicalTickets(all);
  const listed = rows.map((s): Cell[] => {
    const ops = opportunities(s, typical[s.account_id], (n) => String(Math.round(n)));
    const c = change(s);
    const dr = deliveryRate(s);
    return [
      s.name,
      s.account_name,
      HEALTH[classify(s)].label,
      ops[0] ? `${ops[0].text} → ${ops[0].action}` : null,
      s.today,
      s.d7,
      s.prev7,
      c === null ? null : Math.round(c * 100),
      round(s.d7 / 7, 1),
      s.active7,
      s.n30,
      round(s.sales30, 2),
      round(s.ticket, 2),
      round(s.units_per_order, 2),
      round(s.vendor_per_order, 2),
      s.skus30,
      s.top_product,
      s.top_share === null ? null : Math.round(s.top_share * 100),
      dr === null ? null : Math.round(dr * 100),
      localTime(s.last_at, tzOf.get(s.account_id) ?? "America/Tegucigalpa"),
      s.days_since,
      s.currency,
      ...contactCells(s),
    ];
  });

  // hoja 2: tiendas que ya trabajaron con Miranova sin ventas en 60 días (sin pedidos, o solo cancelados); misma búsqueda y grupo
  const inList = new Set(all.map((s) => contactKey(s)));
  const dormant = f.h && f.h !== "inactive"
    ? []
    : filterStores(
        directory.filter((d) => (!scope.account || d.account_id === scope.account) && !inList.has(contactKey(d)) && (!f.g || (f.g === "con") === hasGroup(d))),
        { keys: f.t, q: f.q },
      ).sort((a, b) => (b.last_at ?? "").localeCompare(a.last_at ?? ""));
  const now = Date.now();
  const dormantRows = dormant.map((d): Cell[] => [
    d.name,
    d.account_name,
    localTime(d.last_at, tzOf.get(d.account_id) ?? "America/Tegucigalpa"),
    d.last_at ? Math.floor((now - Date.parse(d.last_at)) / 86_400_000) : null,
    ...contactCells(d),
  ]);

  const book = buildXlsx([
    {
      name: "Tiendas",
      columns: [
        { header: "Tienda", width: 28 },
        { header: "Cuenta", width: 18 },
        { header: "Estado", width: 13 },
        { header: "Qué hacer", width: 60 },
        { header: "Pedidos hoy", width: 11 },
        { header: "Pedidos 7 días", width: 13 },
        { header: "Pedidos 7 días anteriores", width: 15 },
        { header: "Variación 7 días (%)", width: 13 },
        { header: "Ritmo por día", width: 11 },
        { header: "Días activos (de 7)", width: 12 },
        { header: "Pedidos 30 días", width: 13 },
        { header: "Venta 30 días", width: 14 },
        { header: "Ticket promedio 30 días", width: 14 },
        { header: "Unidades por pedido", width: 12 },
        { header: "Te toca por pedido", width: 13 },
        { header: "Productos 30 días", width: 12 },
        { header: "Producto principal", width: 36 },
        { header: "% pedidos del producto principal", width: 14 },
        { header: "Entrega 30 días (%)", width: 12 },
        { header: "Última venta", width: 17 },
        { header: "Días sin vender", width: 11 },
        { header: "Moneda", width: 8 },
        ...CONTACT_HEADERS,
      ],
      rows: listed,
    },
    {
      name: "Sin ventas en 60 días",
      columns: [
        { header: "Tienda", width: 28 },
        { header: "Cuenta", width: 18 },
        { header: "Último pedido", width: 17 },
        { header: "Días sin pedidos", width: 12 },
        ...CONTACT_HEADERS,
      ],
      rows: dormantRows,
    },
  ]);

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(book), {
    headers: {
      "content-type": XLSX_TYPE,
      "content-disposition": `attachment; filename="tiendas-miranova-${stamp}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
