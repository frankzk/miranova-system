import type { PlatformId } from "../countries";
import { boxful } from "./boxful";
import { dropi } from "./dropi";
import { soydrop } from "./soydrop";
import { type Connector, PlatformError } from "./types";

export function connectorFor(platform: PlatformId | string, country = "GT", timezone?: string): Connector {
  if (platform === "soydrop") return soydrop;
  if (platform === "dropi") return dropi(country, timezone);
  if (platform === "boxful") return boxful;
  throw new PlatformError(`Plataforma desconocida: ${platform}`);
}

export * from "./types";
