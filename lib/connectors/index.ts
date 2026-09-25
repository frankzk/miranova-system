import type { PlatformId } from "../countries";
import { soydrop } from "./soydrop";
import { PlatformError, type Connector } from "./types";

export function connectorFor(platform: PlatformId | string): Connector {
  if (platform === "soydrop") return soydrop;
  if (platform === "dropi") throw new PlatformError("Dropi estará disponible pronto");
  throw new PlatformError(`Plataforma desconocida: ${platform}`);
}

export * from "./types";
