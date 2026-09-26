export type Country = { code: string; name: string; currency: string; timezone: string };

export const COUNTRIES: Country[] = [
  { code: "HN", name: "Honduras", currency: "HNL", timezone: "America/Tegucigalpa" },
  { code: "GT", name: "Guatemala", currency: "GTQ", timezone: "America/Guatemala" },
  { code: "SV", name: "El Salvador", currency: "USD", timezone: "America/El_Salvador" },
  { code: "NI", name: "Nicaragua", currency: "NIO", timezone: "America/Managua" },
  { code: "CR", name: "Costa Rica", currency: "CRC", timezone: "America/Costa_Rica" },
  { code: "PA", name: "Panamá", currency: "USD", timezone: "America/Panama" },
  { code: "DO", name: "República Dominicana", currency: "DOP", timezone: "America/Santo_Domingo" },
  { code: "MX", name: "México", currency: "MXN", timezone: "America/Mexico_City" },
  { code: "CO", name: "Colombia", currency: "COP", timezone: "America/Bogota" },
  { code: "EC", name: "Ecuador", currency: "USD", timezone: "America/Guayaquil" },
  { code: "PE", name: "Perú", currency: "PEN", timezone: "America/Lima" },
  { code: "CL", name: "Chile", currency: "CLP", timezone: "America/Santiago" },
  { code: "PY", name: "Paraguay", currency: "PYG", timezone: "America/Asuncion" },
  { code: "AR", name: "Argentina", currency: "ARS", timezone: "America/Argentina/Buenos_Aires" },
  { code: "ES", name: "España", currency: "EUR", timezone: "Europe/Madrid" },
];

export const countryByCode = (code: string) => COUNTRIES.find((c) => c.code === code);

export const PLATFORMS = [
  { id: "soydrop", name: "Drop (soydrop.com)", ready: true },
  { id: "dropi", name: "Dropi", ready: true },
] as const;

export type PlatformId = (typeof PLATFORMS)[number]["id"];
