import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { InvoiceExtract } from "./invoice";

// Leer una factura o proforma (PDF o foto) con Claude y devolver sus líneas como datos. Con los
// datos simulados (MIRANOVA_FIXTURES=1) devuelve un ejemplo fijo, sin llamar a la API.

const MODEL = "claude-opus-5-5";

const InvoiceSchema = z.object({
  supplier: z.string().nullable().describe("Nombre del proveedor o vendedor"),
  invoice_number: z.string().nullable(),
  invoice_date: z.string().nullable().describe("Fecha de la factura, YYYY-MM-DD"),
  currency: z.string().nullable().describe("Moneda de los precios, código ISO 4217 (USD, CNY…)"),
  lines: z.array(
    z.object({
      description: z.string().describe("Nombre del producto, en español"),
      sku: z.string().nullable().describe("Código o SKU del producto, si aparece"),
      quantity: z.number().describe("Unidades totales (si viene por cajas, cajas × unidades por caja)"),
      unit_price: z.number().nullable().describe("Precio por unidad, en la moneda de la factura"),
      line_total: z.number().nullable(),
    }),
  ),
  charges: z.array(
    z.object({
      label: z.string().describe("Nombre del cargo, en español"),
      kind: z.enum(["shipping", "import", "other"]).describe("shipping: flete o envío; import: aranceles, impuestos, aduana; other: el resto"),
      amount: z.number(),
    }),
  ),
  total: z.number().nullable(),
  notes: z.string().nullable().describe("Algo importante que no entra en los campos (condiciones, descuentos), o null"),
});

const SYSTEM = `Lees facturas, proformas y packing lists de proveedores (muchas veces de China) para registrar una importación.
Devuelve cada producto como una línea, con las unidades totales y el precio por unidad en la moneda de la factura.
Si la cantidad viene por cajas o cartones con unidades por caja, multiplica para dar unidades.
Los cargos que no son productos (flete, envío, seguro, aranceles, comisión bancaria, embalaje) van en charges, no en lines.
Traduce al español los nombres de productos y cargos que estén en otro idioma, sin inventar detalles.
Si un dato no aparece en el documento, usa null; no lo calcules ni lo supongas, salvo las unidades por caja.`;

export type ReadResult = { ok: true; data: InvoiceExtract; model: string } | { ok: false; msg: string };

export async function readInvoice(bytes: Uint8Array, mime: string, apiKey: string): Promise<ReadResult> {
  if (process.env.MIRANOVA_FIXTURES === "1") return { ok: true, data: FAKE, model: "simulado" };
  const data = Buffer.from(bytes).toString("base64");
  const file =
    mime === "application/pdf"
      ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data } }
      : { type: "image" as const, source: { type: "base64" as const, media_type: mime as "image/jpeg" | "image/png" | "image/webp", data } };
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  try {
    const res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // si el modelo declina por política, la API reintenta sola con otro modelo
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(InvoiceSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: [file, { type: "text", text: "Extrae las líneas de producto y los cargos de este documento." }] }],
    });
    if (res.stop_reason === "refusal") return { ok: false, msg: "La IA no pudo leer este documento. Agrega los productos a mano." };
    if (res.stop_reason === "max_tokens") return { ok: false, msg: "La factura es demasiado larga para leerla de una vez. Prueba con menos páginas." };
    if (!res.parsed_output) return { ok: false, msg: "La IA respondió sin un formato válido. Inténtalo de nuevo." };
    return { ok: true, data: res.parsed_output, model: res.model };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { ok: false, msg: "La clave de Anthropic no es válida: revísala en Ajustes → Integraciones." };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, msg: "La IA está ocupada ahora mismo. Inténtalo en un minuto." };
    if (e instanceof Anthropic.BadRequestError) return { ok: false, msg: `La IA no aceptó el archivo: ${e.message}` };
    if (e instanceof Anthropic.APIError) return { ok: false, msg: `La IA respondió con un error (${e.status ?? "sin código"}). Inténtalo de nuevo.` };
    return { ok: false, msg: "No se pudo conectar con la IA. Revisa la conexión e inténtalo de nuevo." };
  }
}

/** Ejemplo para pruebas locales. */
const FAKE: InvoiceExtract = {
  supplier: "Yiwu Trading Co.",
  invoice_number: "PI-2026-0917",
  invoice_date: "2026-09-17",
  currency: "CNY",
  lines: [
    { description: "Set de pelador de verduras", sku: "00940184", quantity: 200, unit_price: 12.6, line_total: 2520 },
    { description: "Organizador de cocina giratorio", sku: null, quantity: 120, unit_price: 21, line_total: 2520 },
    { description: "Cepillo de limpieza eléctrico", sku: "CB-88", quantity: 80, unit_price: null, line_total: 1440 },
  ],
  charges: [
    { label: "Flete marítimo", kind: "shipping", amount: 700 },
    { label: "Comisión bancaria", kind: "other", amount: 35 },
  ],
  total: 7215,
  notes: "30 % de anticipo, saldo antes del embarque.",
};
