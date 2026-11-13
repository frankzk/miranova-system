import { bearerKey, methodNotAllowed, serveMcp } from "@/lib/mcp-server";

// MCP para asistentes (Grok, Claude…): la llave va en "Authorization: Bearer mnv_…".
// Las llaves se crean en Ajustes › Integraciones › Asistentes.

export const maxDuration = 60;

export async function POST(req: Request) {
  return serveMcp(req, bearerKey(req));
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
