// Factura leída con IA → líneas y costos de la importación. Puro, para probarlo; la lectura está
// en lib/invoice-ai.ts. Los montos se pasan a USD con el tipo de cambio que se indique.
import { matchNewProduct } from "./imports.ts";

export type InvoiceLine = { description: string; sku: string | null; quantity: number; unit_price: number | null; line_total: number | null };
export type InvoiceCharge = { label: string; kind: "shipping" | "import" | "other"; amount: number };
export type InvoiceExtract = {
  supplier: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  currency: string | null;
  lines: InvoiceLine[];
  charges: InvoiceCharge[];
  total: number | null;
  notes: string | null;
};

export type Match = { account_id: string; external_id: string; name: string };
export type ProposalLine = InvoiceLine & { match: Match | null };
export type Proposal = Omit<InvoiceExtract, "lines"> & { lines: ProposalLine[] };

/** Cada línea con su producto de Drop sugerido (por SKU o nombre, solo si hay uno). */
export function withMatches<P extends { account_id: string; external_id: string; name: string; sku: string | null }>(inv: InvoiceExtract, catalog: P[]): Proposal {
  return {
    ...inv,
    lines: inv.lines
      .filter((l) => l.description.trim() && l.quantity > 0)
      .map((l) => {
        const m = matchNewProduct({ name: l.description, sku: l.sku }, catalog);
        return { ...l, match: m ? { account_id: m.account_id, external_id: m.external_id, name: m.name } : null };
      }),
  };
}

/** Precio unitario en USD: el de la línea o, si falta, el total ÷ cantidad; dividido por el tipo de cambio (1 USD = rate). */
export function unitUsd(l: Pick<InvoiceLine, "unit_price" | "line_total" | "quantity">, rate: number): number | null {
  const price = l.unit_price ?? (l.line_total !== null && l.quantity > 0 ? l.line_total / l.quantity : null);
  if (price === null || !(rate > 0)) return null;
  return Math.round((price / rate) * 10_000) / 10_000;
}

/** Reparto por defecto de un cargo de la factura (igual que al agregar un costo a mano). */
export const chargeAllocation = (kind: InvoiceCharge["kind"]) => (kind === "shipping" ? "weight" : "value");

/** Cantidad entera (las facturas a veces traen 120.0). */
export const wholeQty = (q: number) => Math.max(0, Math.round(q));
