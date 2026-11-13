// Dónde va un envío según la última novedad de la paquetera: en el país de origen, en tránsito (y en qué
// país) o ya en el país de destino. DHL Express manda el lugar como texto ("SHENZHEN - CHINA MAINLAND",
// "CINCINNATI HUB - USA"); a veces con el código de país al final ("LEIPZIG - GERMANY, DE"); 17TRACK,
// "ciudad, estado, país". Sin base de datos, para probarlo.

export type TrackPhase = "origin" | "transit" | "destination" | "delivered";
export type TrackPlace = { phase: TrackPhase; label: string; country: string | null; city: string | null };

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().replace(/\s+/g, " ").trim();

/** Nombres (inglés y español) de los países que más aparecen en las guías → código ISO. */
const NAMES: Record<string, string> = {
  "CHINA": "CN", "CHINA MAINLAND": "CN", "PEOPLES REPUBLIC OF CHINA": "CN", "HONG KONG": "HK", "HONG KONG SAR": "HK", "HONG KONG SAR CHINA": "HK",
  "USA": "US", "UNITED STATES": "US", "UNITED STATES OF AMERICA": "US", "ESTADOS UNIDOS": "US", "EEUU": "US", "EE UU": "US",
  "GUATEMALA": "GT", "HONDURAS": "HN", "EL SALVADOR": "SV", "COSTA RICA": "CR", "NICARAGUA": "NI", "PANAMA": "PA",
  "MEXICO": "MX", "COLOMBIA": "CO", "PERU": "PE", "ECUADOR": "EC", "CHILE": "CL", "SPAIN": "ES", "ESPANA": "ES",
  "GERMANY": "DE", "ALEMANIA": "DE", "NETHERLANDS": "NL", "UNITED KINGDOM": "GB", "SOUTH KOREA": "KR", "KOREA": "KR",
  "JAPAN": "JP", "TAIWAN": "TW", "SINGAPORE": "SG", "INDIA": "IN", "TURKEY": "TR", "TURKIYE": "TR", "UNITED ARAB EMIRATES": "AE",
  "BRAZIL": "BR", "BRASIL": "BR", "CANADA": "CA", "DOMINICAN REPUBLIC": "DO", "REPUBLICA DOMINICANA": "DO",
};

/** Nombre en español para mostrar. */
const ES: Record<string, string> = {
  CN: "China", HK: "Hong Kong", US: "Estados Unidos", GT: "Guatemala", HN: "Honduras", SV: "El Salvador", CR: "Costa Rica",
  NI: "Nicaragua", PA: "Panamá", MX: "México", CO: "Colombia", PE: "Perú", EC: "Ecuador", CL: "Chile", ES: "España",
  DE: "Alemania", NL: "Países Bajos", GB: "Reino Unido", KR: "Corea del Sur", JP: "Japón", TW: "Taiwán", SG: "Singapur",
  IN: "India", TR: "Turquía", AE: "Emiratos Árabes Unidos", BR: "Brasil", CA: "Canadá", DO: "República Dominicana",
};

export const countryNameEs = (code: string) => ES[code] ?? code;

/** Código de un nombre de país (o del código mismo si ya lo es). */
export function countryCode(name: string | null | undefined): string | null {
  const n = fold(name ?? "").replace(/[.,]/g, "");
  if (!n) return null;
  if (NAMES[n]) return NAMES[n];
  if (/^[A-Z]{2}$/.test(n) && (ES[n] || Object.values(NAMES).includes(n))) return n;
  return null;
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());

/** País y ciudad de un lugar escrito por la paquetera. */
export function parsePlace(location: string | null | undefined): { country: string | null; city: string | null } {
  const raw = (location ?? "").trim();
  if (!raw) return { country: null, city: null };
  // "LEIPZIG - GERMANY, DE" / "Guatemala City, GT" / "Miami, FL, US"
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  let country: string | null = null;
  for (let i = parts.length - 1; i >= 0 && !country; i--) country = countryCode(parts[i]);
  const head = parts[0] ?? raw;
  // "SHENZHEN - CHINA MAINLAND": la ciudad antes del guion, el país después
  const dash = head.split(/\s+-\s+/);
  if (dash.length > 1) {
    country ??= countryCode(dash[dash.length - 1]);
    return { country, city: titleCase(dash.slice(0, -1).join(" - ").replace(/\s+HUB$/i, "")) || null };
  }
  country ??= countryCode(head);
  return { country, city: countryCode(head) ? null : titleCase(head) };
}

/** Países que cuentan como "origen" según lo que dice la importación ("China", "China, Yiwu", "Estados Unidos, Miami"). */
export function originCountries(origin: string | null | undefined): string[] {
  const code = countryCode((origin ?? "").split(",")[0]);
  if (!code) return [];
  // lo de China casi siempre sale por Hong Kong
  return code === "CN" ? ["CN", "HK"] : [code];
}

/**
 * Dónde va según su estado y la última novedad: "En China (origen)", "En tránsito · Estados Unidos",
 * "En Guatemala (destino)" o "Entregado". Null si todavía no hay novedades.
 */
export function trackPlace(
  t: { status: string | null | undefined; location: string | null | undefined },
  imp: { dest_country: string; origin: string | null | undefined },
): TrackPlace | null {
  const { country, city } = parsePlace(t.location);
  if (t.status === "Delivered") return { phase: "delivered", label: "Entregado", country, city };
  if (!t.status && !t.location) return null;
  if (country && country === imp.dest_country) return { phase: "destination", label: `En ${countryNameEs(country)} (destino)`, country, city };
  const origins = originCountries(imp.origin);
  if (country && origins.includes(country)) return { phase: "origin", label: `En ${countryNameEs(country)} (origen)`, country, city };
  // aviso recibido pero sin novedades de lugar: todavía no lo recogen
  if (!country && t.status === "InfoReceived") return { phase: "origin", label: "Por recoger en origen", country, city };
  return { phase: "transit", label: country ? `En tránsito · ${countryNameEs(country)}` : "En tránsito", country, city };
}
