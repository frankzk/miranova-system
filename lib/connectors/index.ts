import type { PlatformId } from "../countries";
import { dropi } from "./dropi";
import { soydrop } from "./soydrop";
import { type Connector, PlatformError } from "./types";

export function connectorFor(platform: PlatformId | string, country = "GT", timezone?: string): Connector {
  if (platform === "soydrop") return soydrop;
  if (platform === "dropi") return dropi(country, timezone);
  throw new PlatformError(`Plataforma desconocida: ${platform}`);
}

export * from "./types";
