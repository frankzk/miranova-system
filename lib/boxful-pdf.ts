import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import { boxfulProposal, type BoxfulReadResult } from "./boxful-document.ts";
import { parseBoxfulText } from "./boxful-text.ts";
import { readBoxfulPdf } from "./boxful-document-ai.ts";
import { parseBacTransfer } from "./boxful-bac.ts";

/** Lee texto localmente primero. Solo recurre a IA si faltan datos inequívocos. */
export async function readBoxfulDocument(bytes: Uint8Array, key: string | null | (() => Promise<string | null>), scope: string, today: string): Promise<BoxfulReadResult> {
  let partial: BoxfulReadResult | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const extraction = async () => {
      const pdf = await getDocumentProxy(new Uint8Array(bytes), { maxImageSize: 16_777_216, verbosity: 0 });
      try {
        if (pdf.numPages > 40) throw new Error("page-limit");
        const text = (await extractText(pdf, { mergePages: true })).text;
        if (text.length > 200_000) throw new Error("text-limit");
        return text;
      } finally { await pdf.loadingTask.destroy(); }
    };
    const text = await Promise.race([
      extraction(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 15_000); }),
    ]);
    const read = parseBacTransfer(text) ?? parseBoxfulText(text);
    const proposal = boxfulProposal(read, today);
    partial = { ok: true, proposal };
    if (read.kind === "multiple_transfers" || (proposal.fields.reference && proposal.fields.occurred_on && proposal.fields.amount && proposal.fields.original_currency)) return partial;
  } catch (error) {
    if (error instanceof Error && ["page-limit", "text-limit", "timeout"].includes(error.message))
      return { ok: false, msg: "El PDF supera el límite de lectura. Usa un comprobante de hasta 40 páginas o completa los datos manualmente." };
    // PDF escaneado, protegido o sin texto utilizable: alternativa visual.
  }
  finally { clearTimeout(timer); }
  const { readBacScan } = await import("./boxful-ocr.ts");
  const scanned = await readBacScan(bytes);
  if (scanned) {
    partial = { ok: true, proposal: boxfulProposal(scanned, today) };
    // No enviar a IA un comprobante BAC reconocido; los campos dudosos se revisan.
    return partial;
  }
  const resolvedKey = typeof key === "function" ? await key().catch(() => null) : key;
  const visual = await readBoxfulPdf(bytes, resolvedKey, scope, today);
  if (visual.ok) return visual;
  if (partial?.ok && Object.values(partial.proposal.fields).some(Boolean)) {
    partial.proposal.warnings.push("La lectura adicional no está disponible. Completa los campos pendientes revisando el PDF.");
    return partial;
  }
  return visual;
}
