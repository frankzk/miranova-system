import { bearerKey, methodNotAllowed, serveMcp } from "@/lib/mcp-server";

// MCP con la llave en la URL (/api/mcp/mnv_…), para clientes que solo aceptan una dirección.

export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  return serveMcp(req, bearerKey(req) ?? (await params).key);
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
