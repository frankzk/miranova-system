import "server-only";
import { countryByCode } from "./countries";
import type { McpTool } from "./mcp";
import { groupCounts, storeHealth } from "./queries";
import { GROUPS, groupOf } from "./status";
import { classify, deliveryRate, HEALTH, matchesStore } from "./stores";
import { db } from "./supabase";
import { isLate, lineLabel, totals, transferStatus, type TransferFull } from "./transfers";
import { documentKinds, listPending, listPoints, listTransfers } from "./transfers-data";

// Consultas del panel para asistentes por MCP, una por permiso de la llave (lib/assistant-scopes.ts).
// Nunca devuelven datos del cliente final (nombre, teléfono, dirección, correo).

const COUNTRY_ENUM = ["HN", "GT", "SV", "CR", "NI", "PA"];
const countryName = (c: string) => countryByCode(c)?.name ?? c;
const json = (head: string, data: Record<string, unknown>) => ({ text: `${head}\n\n${JSON.stringify(data, null, 2)}`, data });
const country = (v: unknown) => (typeof v === "string" && COUNTRY_ENUM.includes(v.toUpperCase()) ? v.toUpperCase() : null);
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

type Account = { id: string; name: string; country: string; enabled: boolean | null; catalog_only: boolean | null };
async function accounts(): Promise<Account[]> {
  const { data, error } = await db().from("accounts").select("id, name, country, enabled, catalog_only");
  if (error) throw error;
  return ((data ?? []) as Account[]).filter((a) => a.enabled !== false && !a.catalog_only);
}

// ─── Pedidos ───

type OrderRow = {
  id: string; account_id: string; external_id: string; shopify_order: string | null; status: string | null; status_code: string | null; dropshipper: string | null;
  carrier: string | null; tracking_number: string | null; tracking_url: string | null; total: number | null; currency: string | null; cod: boolean | null;
  ordered_at: string | null; updated_at: string; timeline?: unknown; raw?: { orderInfo?: { statusTimeline?: unknown } };
  order_items?: { product_name: string; quantity: number }[];
};

const timelineOf = (t: unknown) =>
  (Array.isArray(t) ? (t as { label?: unknown; occurredAt?: unknown }[]) : [])
    .filter((e) => e && e.label)
    .map((e) => ({ estado: String(e.label), fecha: String(e.occurredAt ?? "") }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

export const orderTools: McpTool[] = [
  {
    name: "buscar_pedido",
    title: "Buscar pedido",
    description:
      "Busca un pedido por su número de Drop (13 dígitos), su número de Shopify o su número de guía (FD…). Devuelve tienda, país, estado, historial de estados con fechas, paquetera, guía y productos. No incluye datos del cliente final.",
    inputSchema: { type: "object", properties: { numero: { type: "string", description: "Número de pedido de Drop, de Shopify o de guía." } }, required: ["numero"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (args) => {
      const q = String(args.numero ?? "").trim().replace(/^#/, "");
      if (!/^[A-Za-z0-9-]{3,40}$/.test(q)) return { text: "Escribe el número de pedido o de guía (solo letras, números y guiones).", isError: true };
      const [res, accs] = await Promise.all([
        db().from("orders")
          .select("id, account_id, external_id, shopify_order, status, status_code, dropshipper, carrier, tracking_number, tracking_url, total, currency, cod, ordered_at, updated_at, timeline:raw->orderInfo->statusTimeline, order_items(product_name, quantity)")
          .or(`external_id.eq.${q},shopify_order.eq.${q},tracking_number.eq.${q}`)
          .order("ordered_at", { ascending: false })
          .limit(5),
        accounts(),
      ]);
      if (res.error) throw res.error;
      const byId = new Map(accs.map((a) => [a.id, a]));
      const pedidos = ((res.data ?? []) as unknown as OrderRow[]).map((o) => {
        const acc = byId.get(o.account_id);
        return {
          numero: o.external_id, shopify: o.shopify_order, cuenta: acc?.name ?? null, pais: acc ? countryName(acc.country) : null, tienda: o.dropshipper,
          estado: o.status, grupo: GROUPS.find((g) => g.id === groupOf(o.status_code))?.label ?? null,
          paquetera: o.carrier, guia: o.tracking_number, seguimiento: o.tracking_url,
          total: o.total === null ? null : Number(o.total), moneda: o.currency, contra_entrega: o.cod,
          creado: o.ordered_at, actualizado: o.updated_at,
          historial: timelineOf(o.timeline ?? o.raw?.orderInfo?.statusTimeline),
          productos: (o.order_items ?? []).map((i) => ({ nombre: i.product_name, cantidad: Number(i.quantity) })),
        };
      });
      if (!pedidos.length) return { text: `No encontré ningún pedido con el número o la guía ${q}.`, data: { pedidos: [] } };
      return json(pedidos.length === 1 ? `Pedido ${pedidos[0].numero}: ${pedidos[0].estado ?? "sin estado"}.` : `Encontré ${pedidos.length} pedidos con ${q}.`, { pedidos });
    },
  },
  {
    name: "resumen_pedidos",
    title: "Pedidos por estado",
    description:
      "Cuenta los pedidos creados en los últimos días en cada país, por estado: por despachar (y cuántos con retraso de despacho), en tránsito, entregadas, con problemas, no entregadas y canceladas.",
    inputSchema: {
      type: "object",
      properties: {
        dias: { type: "integer", minimum: 1, maximum: 90, description: "Pedidos creados en los últimos N días (1 = hoy). Por defecto 7." },
        pais: { type: "string", enum: COUNTRY_ENUM, description: "Solo este país (opcional)." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (args) => {
      const dias = Math.min(90, Math.max(1, Math.floor(Number(args.dias ?? 7)) || 7));
      const pais = country(args.pais);
      const from = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tegucigalpa" }).format(new Date(Date.now() - (dias - 1) * 86_400_000));
      const accs = (await accounts()).filter((a) => !pais || a.country === pais);
      const rows = await Promise.all(accs.map(async (a) => {
        const c = await groupCounts({ account: a.id, from });
        return {
          cuenta: a.name, pais: countryName(a.country), total: c.all ?? 0,
          ...Object.fromEntries(GROUPS.map((g) => [g.label, c[g.id] ?? 0])),
          "Con retraso de despacho": c.late ?? 0,
        };
      }));
      return json(`Pedidos creados desde el ${from} (${dias} ${dias === 1 ? "día" : "días"}).`, { desde: from, cuentas: rows });
    },
  },
];

// ─── Tiendas ───

export const storeTools: McpTool[] = [
  {
    name: "buscar_tienda",
    title: "Buscar tienda",
    description:
      "Busca tiendas por nombre (sirve una parte) y devuelve sus números: pedidos de hoy, de 7 días y de los 7 anteriores, de 30 días, entregadas y no entregadas en 30 días, tasa de entrega, salud (creciendo, estable, alerta…), último pedido y su producto más pedido.",
    inputSchema: {
      type: "object",
      properties: { nombre: { type: "string", description: "Nombre o parte del nombre de la tienda." }, pais: { type: "string", enum: COUNTRY_ENUM, description: "Solo este país (opcional)." } },
      required: ["nombre"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (args) => {
      const q = String(args.nombre ?? "").trim().slice(0, 80);
      if (q.length < 2) return { text: "Escribe al menos dos letras del nombre de la tienda.", isError: true };
      const pais = country(args.pais);
      const [rows, accs] = await Promise.all([storeHealth(), accounts()]);
      const byId = new Map(accs.map((a) => [a.id, a]));
      const found = rows
        .filter((s) => byId.has(s.account_id) && (!pais || byId.get(s.account_id)!.country === pais) && matchesStore(s.name, q))
        .sort((a, b) => b.n30 - a.n30)
        .slice(0, 10)
        .map((s) => {
          const rate = deliveryRate(s);
          return {
            tienda: s.name, cuenta: s.account_name, pais: countryName(byId.get(s.account_id)!.country), salud: HEALTH[classify(s)].label,
            pedidos_hoy: s.today, pedidos_7_dias: s.d7, pedidos_7_dias_anteriores: s.prev7, pedidos_30_dias: s.n30,
            entregadas_30_dias: s.delivered30, no_entregadas_30_dias: s.failed30, tasa_de_entrega: rate === null ? null : `${Math.round(rate * 100)} %`,
            ultimo_pedido: s.last_at, dias_sin_pedidos: s.days_since, producto_mas_pedido: s.top_product,
          };
        });
      if (!found.length) return { text: `No encontré tiendas con "${q}".`, data: { tiendas: [] } };
      return json(`${found.length === 1 ? "1 tienda" : `${found.length} tiendas`} con "${q}".`, { tiendas: found });
    },
  },
];

// ─── Traslados ───

const VIEW: Record<string, (t: TransferFull) => boolean> = {
  en_camino: (t) => t.status === "transit",
  preparando: (t) => t.status === "preparing",
  llegaron: (t) => t.status === "arrived",
  cancelados: (t) => t.status === "cancelled",
  todos: () => true,
};

export const transferTools: McpTool[] = [
  {
    name: "traslados",
    title: "Traslados entre bodegas",
    description:
      "Lista los traslados entre bodegas (Boxful Guatemala o Bodega de Moi hacia Honduras, El Salvador, Costa Rica…): estado, salida, llegada estimada (y si está vencida), unidades enviadas y recibidas, merma, dañadas, productos con su variante y si ya tiene el manifiesto.",
    inputSchema: {
      type: "object",
      properties: {
        estado: { type: "string", enum: Object.keys(VIEW), description: "Por defecto en_camino." },
        pais: { type: "string", enum: COUNTRY_ENUM, description: "País de destino (opcional)." },
        codigo: { type: "string", description: "Un traslado puntual, p. ej. TR-2026-004 (opcional)." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (args) => {
      const estado = typeof args.estado === "string" && VIEW[args.estado] ? args.estado : "en_camino";
      const pais = country(args.pais);
      const code = typeof args.codigo === "string" ? args.codigo.trim().toUpperCase() : "";
      const [all, points, docs] = await Promise.all([listTransfers(), listPoints(), documentKinds()]);
      const name = new Map(points.map((p) => [p.id, p.name]));
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tegucigalpa" }).format(new Date());
      const list = all
        .filter((t) => (code ? t.code === code : VIEW[estado](t) && (!pais || t.dest_country === pais)))
        .slice(0, 30)
        .map((t) => {
          const tt = totals(t.items);
          return {
            codigo: t.code, sale_de: name.get(t.origin_id) ?? null, va_a: countryName(t.dest_country), estado: transferStatus(t.status).label,
            lo_lleva: t.carrier, manifiesto: t.reference, manifiesto_subido: (docs.get(t.id) ?? []).includes("manifest"),
            salida: t.shipped_at, llegada_estimada: t.eta, vencido: isLate(t, today),
            llegadas: t.arrivals.map((a) => ({ bodega: name.get(a.dest_id) ?? null, fecha: a.arrived_at })),
            unidades_enviadas: tt.sent, unidades_recibidas: tt.counted ? tt.received : null, merma: tt.counted ? tt.shortage : null, danadas: tt.counted ? tt.damaged : null,
            productos: t.items.map((i) => ({
              producto: lineLabel(i), bodega: name.get(i.dest_id) ?? null, enviadas: i.qty,
              recibidas: i.received_qty, danadas: i.received_qty === null ? null : i.damaged_qty,
            })),
          };
        });
      const head = code ? (list.length ? `Traslado ${code}.` : `No existe el traslado ${code}.`) : `${list.length} ${list.length === 1 ? "traslado" : "traslados"} (${estado.replace("_", " ")}).`;
      return json(head, { traslados: list });
    },
  },
  {
    name: "por_enviar",
    title: "Por enviar",
    description: "Lo que falta mandar a cada país según lo repartido en Solicitudes y Laboratorios, menos lo que ya salió en traslados.",
    inputSchema: { type: "object", properties: { pais: { type: "string", enum: COUNTRY_ENUM, description: "Solo este país (opcional)." } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (args) => {
      const pais = country(args.pais);
      const [transfers, points] = await Promise.all([listTransfers(), listPoints()]);
      const name = new Map(points.map((p) => [p.id, p.name]));
      const rows = (await listPending(transfers, points))
        .filter((r) => !pais || r.country === pais)
        .map((r) => ({
          producto: r.product, pais: countryName(r.country), bodega: r.dest_id ? name.get(r.dest_id) ?? null : null, de: r.from, estado: r.state,
          fecha: day(r.date), repartido: r.allocated, enviado: r.sent, falta: r.pending,
        }));
      return json(rows.length ? `${rows.length} ${rows.length === 1 ? "reparto pendiente" : "repartos pendientes"}.` : "No hay nada pendiente por enviar.", { por_enviar: rows });
    },
  },
];
