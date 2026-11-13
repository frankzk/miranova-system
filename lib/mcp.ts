// Servidor MCP mínimo (Model Context Protocol, transporte HTTP "streamable" sin sesión): cada POST trae
// un mensaje JSON-RPC y se responde con JSON, sin streams. Solo herramientas. Sin Next ni base de datos,
// para probarlo; la ruta /api/mcp le pasa las herramientas ya con su usuario autenticado.

export const MCP_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export type McpResult = { text: string; data?: Record<string, unknown>; isError?: boolean };

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run: (args: Record<string, unknown>) => Promise<McpResult>;
};

export type McpServerInfo = { name: string; title: string; version: string; instructions: string };

type Id = string | number | null;
type RpcResponse = { jsonrpc: "2.0"; id: Id; result?: unknown; error?: { code: number; message: string } };

export const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL = -32603;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const err = (id: Id, code: number, message: string): RpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

async function one(msg: unknown, tools: readonly McpTool[], info: McpServerInfo): Promise<RpcResponse | null> {
  if (!isObj(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    const id = isObj(msg) && (typeof msg.id === "string" || typeof msg.id === "number") ? msg.id : null;
    // una respuesta del cliente (sin método) no lleva contestación
    if (isObj(msg) && msg.jsonrpc === "2.0" && "id" in msg && ("result" in msg || "error" in msg)) return null;
    return err(id, INVALID_REQUEST, "Mensaje JSON-RPC inválido");
  }
  // notificaciones (sin id): no llevan respuesta
  if (!("id" in msg)) return null;
  const id = typeof msg.id === "string" || typeof msg.id === "number" ? msg.id : null;
  const params = isObj(msg.params) ? msg.params : {};
  switch (msg.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (MCP_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_VERSIONS[0];
      return {
        jsonrpc: "2.0", id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: info.name, title: info.title, version: info.version },
          instructions: info.instructions,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return {
        jsonrpc: "2.0", id,
        result: { tools: tools.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, ...(annotations ? { annotations } : {}) })) },
      };
    case "tools/call": {
      const tool = tools.find((t) => t.name === params.name);
      if (!tool) return err(id, INVALID_PARAMS, `No existe la herramienta ${String(params.name ?? "")}`);
      const args = isObj(params.arguments) ? params.arguments : {};
      try {
        const r = await tool.run(args);
        return {
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text: r.text }], ...(r.data ? { structuredContent: r.data } : {}), isError: !!r.isError },
        };
      } catch (e) {
        console.error(`mcp ${tool.name}`, e);
        // los errores de la herramienta van como resultado, para que el asistente los lea
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "Error interno del panel. Intenta de nuevo en unos minutos." }], isError: true } };
      }
    }
    default:
      return err(id, METHOD_NOT_FOUND, `Método no soportado: ${msg.method}`);
  }
}

/**
 * Atiende el cuerpo de un POST: un mensaje o una lista. Devuelve 202 sin cuerpo si solo eran
 * notificaciones o respuestas.
 */
export async function handleMcp(body: unknown, tools: readonly McpTool[], info: McpServerInfo): Promise<{ status: number; json?: unknown }> {
  if (Array.isArray(body)) {
    if (!body.length) return { status: 400, json: err(null, INVALID_REQUEST, "Lista vacía") };
    const out = (await Promise.all(body.map((m) => one(m, tools, info)))).filter((r): r is RpcResponse => r !== null);
    return out.length ? { status: 200, json: out } : { status: 202 };
  }
  const r = await one(body, tools, info).catch(() => err(null, INTERNAL, "Error interno"));
  return r ? { status: 200, json: r } : { status: 202 };
}

export const parseErrorResponse = () => err(null, PARSE_ERROR, "JSON inválido");
