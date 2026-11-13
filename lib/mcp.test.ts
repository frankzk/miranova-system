import assert from "node:assert/strict";
import { test } from "node:test";
import { handleMcp, type McpTool } from "./mcp.ts";

const INFO = { name: "miranova", title: "Miranova", version: "1.0.0", instructions: "Usa las herramientas." };
const calls: Record<string, unknown>[] = [];
const TOOLS: McpTool[] = [
  {
    name: "eco", title: "Eco", description: "Devuelve lo que recibe", inputSchema: { type: "object", properties: { x: { type: "string" } } },
    annotations: { readOnlyHint: true },
    run: async (args) => (calls.push(args), { text: `x=${String(args.x)}`, data: { x: args.x } }),
  },
  { name: "falla", title: "Falla", description: "Siempre falla", inputSchema: { type: "object", properties: {} }, run: async () => { throw new Error("boom"); } },
];

test("initialize: acuerda la versión y presenta el servidor", async () => {
  const r = await handleMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "grok" } } }, TOOLS, INFO);
  assert.equal(r.status, 200);
  const res = (r.json as { result: Record<string, unknown> }).result;
  assert.equal(res.protocolVersion, "2025-03-26");
  assert.deepEqual(res.capabilities, { tools: { listChanged: false } });
  assert.equal((res.serverInfo as { name: string }).name, "miranova");
  assert.equal(res.instructions, "Usa las herramientas.");
  // una versión desconocida recibe la más nueva
  const r2 = await handleMcp({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, TOOLS, INFO);
  assert.equal((r2.json as { result: { protocolVersion: string } }).result.protocolVersion, "2025-06-18");
});

test("notificaciones y respuestas: 202 sin cuerpo", async () => {
  assert.deepEqual(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, TOOLS, INFO), { status: 202 });
  assert.deepEqual(await handleMcp([{ jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 5, result: {} }], TOOLS, INFO), { status: 202 });
});

test("tools/list y tools/call", async () => {
  const list = await handleMcp({ jsonrpc: "2.0", id: "a", method: "tools/list" }, TOOLS, INFO);
  const tools = (list.json as { result: { tools: Record<string, unknown>[] } }).result.tools;
  assert.deepEqual(tools.map((t) => t.name), ["eco", "falla"]);
  assert.equal("run" in tools[0], false);
  assert.deepEqual(tools[0].annotations, { readOnlyHint: true });

  const call = await handleMcp({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "eco", arguments: { x: "hola" } } }, TOOLS, INFO);
  assert.deepEqual(call.json, { jsonrpc: "2.0", id: 7, result: { content: [{ type: "text", text: "x=hola" }], structuredContent: { x: "hola" }, isError: false } });
  assert.deepEqual(calls.at(-1), { x: "hola" });

  const bad = await handleMcp({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "falla" } }, TOOLS, INFO);
  assert.equal((bad.json as { result: { isError: boolean } }).result.isError, true);

  const none = await handleMcp({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "nada" } }, TOOLS, INFO);
  assert.equal((none.json as { error: { code: number } }).error.code, -32602);
});

test("errores de protocolo", async () => {
  const unknown = await handleMcp({ jsonrpc: "2.0", id: 1, method: "resources/list" }, TOOLS, INFO);
  assert.equal((unknown.json as { error: { code: number } }).error.code, -32601);
  const invalid = await handleMcp({ id: 1, method: "ping" }, TOOLS, INFO);
  assert.equal((invalid.json as { error: { code: number } }).error.code, -32600);
  const empty = await handleMcp([], TOOLS, INFO);
  assert.equal(empty.status, 400);
  const ping = await handleMcp([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/x" }], TOOLS, INFO);
  assert.deepEqual(ping.json, [{ jsonrpc: "2.0", id: 1, result: {} }]);
});
