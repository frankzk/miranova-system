import "server-only";
import { scopeLabel } from "./assistant-scopes";
import { countryByCode } from "./countries";
import { handleMcp, parseErrorResponse, type McpServerInfo, type McpTool } from "./mcp";
import { orderTools, storeTools, transferTools } from "./mcp-panel-tools";
import { markNoticeSent, noticesToday, verifyAssistantKey, type AssistantWho, type IssuedNotice } from "./problem-notices-data";

// Herramientas del panel para asistentes (Grok, Claude…) por MCP. Rutas: /api/mcp (llave en
// "Authorization: Bearer …") y /api/mcp/<llave> (para clientes que solo aceptan una URL).

const NOTICE_STEPS = [
  "Avisos diarios a las tiendas de sus pedidos con \"Problemas en gestión\":",
  "1. Llama avisos_problemas_en_gestion.",
  "2. Por cada aviso de la lista `avisos`: abre su enlace abrir_en_whatsapp_web (o busca el grupo en WhatsApp Web), pega el campo `mensaje` EXACTAMENTE igual, sin cambiar ni un número ni el texto, y envíalo.",
  "3. Apenas esté enviado, llama marcar_aviso_enviado con su aviso_id. Si no pudiste enviarlo, no lo marques: saldrá otra vez en la próxima consulta.",
  "Los de `sin_grupo` no tienen el grupo de WhatsApp cargado en el panel: no los envíes; dile a la persona cuáles son.",
].join("\n");

function info(who: AssistantWho): McpServerInfo {
  const lines = [
    `Panel de Miranova (operación de dropshipping contra entrega en Honduras, Guatemala, El Salvador y Costa Rica). Esta llave ("${who.name}") puede ver: ${who.scopes.map(scopeLabel).join(", ")}.`,
    "No hay datos del cliente final (nombre, teléfono, dirección); no los inventes ni los pidas.",
  ];
  if (who.scopes.includes("avisos")) lines.push("", NOTICE_STEPS);
  return { name: "miranova-panel", title: "Panel de Miranova", version: "1.1.0", instructions: lines.join("\n") };
}

const countryName = (c: string) => countryByCode(c)?.name ?? c;

function noticeView(g: IssuedNotice) {
  return {
    aviso_id: g.batch_id,
    grupo: g.title,
    tiendas: g.stores.map((s) => `${s.name} (${countryName(s.country)})`),
    dueno: g.owner_name,
    abrir_en_whatsapp_web: g.web_url,
    enlace_del_grupo: g.group_url,
    pedidos_nuevos: g.fresh.length,
    recordatorios: g.reminders.length,
    mensaje: g.message,
  };
}

function noticeTools(who: AssistantWho): McpTool[] {
  return [
    {
      name: "avisos_problemas_en_gestion",
      title: "Avisos de Problemas en gestión de hoy",
      description:
        "Lista los avisos de hoy para mandar por WhatsApp: uno por grupo de tienda, con el mensaje ya armado (pedidos y guías con \"Problemas en gestión\" nuevos y recordatorios de los que siguen igual después de 3 días). " +
        "El mensaje se pega tal cual en el grupo, sin cambiarle nada. Después de enviar cada uno, llama marcar_aviso_enviado con su aviso_id.",
      inputSchema: {
        type: "object",
        properties: { pais: { type: "string", enum: ["HN", "GT", "SV", "CR", "NI", "PA"], description: "Solo las tiendas de este país (opcional)." } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: async (args) => {
        const pais = typeof args.pais === "string" ? args.pais.toUpperCase() : null;
        const today = await noticesToday();
        if (!today.ready) return { text: "Los avisos todavía no están activados en el panel (falta la migración).", isError: true };
        const inCountry = (g: IssuedNotice) => !pais || g.stores.some((s) => s.country === pais);
        const avisos = today.groups.filter(inCountry).map(noticeView);
        const sinGrupo = today.missing.filter(inCountry).map(({ batch_id: _b, web_url: _w, group_url: _g, ...g }) => ({
          tiendas: g.stores.map((s) => `${s.name} (${countryName(s.country)})`),
          dueno: g.owner_name,
          pedidos: g.fresh.length + g.reminders.length,
        }));
        const data = { fecha: new Date().toISOString().slice(0, 10), total_avisos: avisos.length, avisos, sin_grupo: sinGrupo };
        const head = avisos.length
          ? `Hay ${avisos.length} ${avisos.length === 1 ? "aviso" : "avisos"} para mandar hoy. Pega cada "mensaje" tal cual en su grupo y luego llama marcar_aviso_enviado con su aviso_id.`
          : "Hoy no hay avisos para mandar.";
        const tail = sinGrupo.length ? ` ${sinGrupo.length} ${sinGrupo.length === 1 ? "tienda tiene" : "tiendas tienen"} pedidos para avisar pero sin grupo de WhatsApp en el panel (sin_grupo): no los envíes.` : "";
        return { text: `${head}${tail}\n\n${JSON.stringify(data, null, 2)}`, data };
      },
    },
    {
      name: "marcar_aviso_enviado",
      title: "Marcar aviso enviado",
      description:
        "Marca como enviado un aviso de avisos_problemas_en_gestion, con su aviso_id. Llámala solo cuando el mensaje ya quedó enviado en el grupo: así no se repite mañana y se recuerda en 3 días si sigue igual.",
      inputSchema: {
        type: "object",
        properties: { aviso_id: { type: "string", description: "El aviso_id tal cual lo dio avisos_problemas_en_gestion." } },
        required: ["aviso_id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      run: async (args) => {
        const id = String(args.aviso_id ?? "").trim().toLowerCase();
        const r = await markNoticeSent(id, "mcp", who.name);
        if (!r.ok) return { text: r.msg, isError: true };
        const text = r.already
          ? `El aviso de ${r.title} ya estaba marcado como enviado.`
          : `Listo: aviso de ${r.title} marcado como enviado (${r.orders} ${r.orders === 1 ? "pedido" : "pedidos"}).`;
        return { text, data: { ok: true, grupo: r.title, pedidos: r.orders, ya_estaba: r.already } };
      },
    },
  ];
}

/** Herramientas según lo que puede ver la llave. */
function tools(who: AssistantWho): McpTool[] {
  return [
    ...(who.scopes.includes("avisos") ? noticeTools(who) : []),
    ...(who.scopes.includes("pedidos") ? orderTools : []),
    ...(who.scopes.includes("tiendas") ? storeTools : []),
    ...(who.scopes.includes("traslados") ? transferTools : []),
  ];
}

const json = (body: unknown, status = 200, headers?: Record<string, string>) => Response.json(body, { status, headers });

/** Atiende un POST de MCP con la llave dada (del encabezado o de la URL). */
export async function serveMcp(req: Request, key: string | null): Promise<Response> {
  const who = await verifyAssistantKey(key);
  if (!who) return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Llave inválida o revocada. Crea una en el panel: Ajustes › Integraciones › Asistentes." } }, 401);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(parseErrorResponse(), 400);
  }
  const r = await handleMcp(body, tools(who), info(who));
  return r.json === undefined ? new Response(null, { status: r.status }) : json(r.json, r.status);
}

/** "Bearer mnv_…" → "mnv_…". */
export function bearerKey(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  return m ? m[1] : null;
}

export const methodNotAllowed = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
