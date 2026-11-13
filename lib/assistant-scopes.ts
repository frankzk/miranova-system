// Qué puede ver cada llave de asistente (Grok, Claude…) por MCP. Se activan de a poco desde Ajustes ›
// Integraciones › Asistentes. Ninguna incluye datos del cliente final (nombre, teléfono, dirección, correo).

export const ASSISTANT_SCOPES = [
  { id: "avisos", label: "Avisos de Problemas en gestión", hint: "Leer los avisos del día para cada grupo de WhatsApp y marcarlos enviados" },
  { id: "pedidos", label: "Pedidos", hint: "Buscar un pedido por número o guía (estado, historial, productos) y contar pedidos por estado. Sin datos del cliente final" },
  { id: "tiendas", label: "Tiendas", hint: "Buscar una tienda: pedidos de hoy, 7 y 30 días, entregas, salud y su producto más pedido" },
  { id: "traslados", label: "Traslados", hint: "Traslados entre bodegas (en camino, llegadas, merma y dañadas) y lo que falta por enviar" },
] as const;

export type AssistantScope = (typeof ASSISTANT_SCOPES)[number]["id"];

export const DEFAULT_SCOPES: AssistantScope[] = ["avisos"];

export const isAssistantScope = (v: unknown): v is AssistantScope => ASSISTANT_SCOPES.some((s) => s.id === v);

/** Permisos válidos, sin repetir y en el orden de la lista. */
export const cleanScopes = (values: readonly unknown[]): AssistantScope[] => ASSISTANT_SCOPES.map((s) => s.id).filter((id) => values.includes(id));

export const scopeLabel = (id: string) => ASSISTANT_SCOPES.find((s) => s.id === id)?.label ?? id;
