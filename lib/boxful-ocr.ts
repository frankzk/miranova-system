import "server-only";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getDocumentProxy, renderPageAsImage } from "unpdf";
import type { BoxfulExtract } from "./boxful-document.ts";
import { parseBacTransfer } from "./boxful-bac.ts";

let busy = false;
/** OCR acotado: modelos locales, sin red, sin archivos del cliente en disco. */
export async function readBacScan(bytes: Uint8Array): Promise<BoxfulExtract | null> {
  if (busy) return null;
  busy = true;
  const require = createRequire(join(process.cwd(), "package.json"));
  let worker: import("tesseract.js").Worker | undefined;
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  try {
    const work = async () => {
      const { createWorker, PSM } = await import("tesseract.js");
      pdf = await getDocumentProxy(new Uint8Array(bytes), { maxImageSize: 16_777_216, verbosity: 0 });
      if (cancelled) { await pdf.loadingTask.destroy(); return null; }
      // No se omiten páginas: así no se elige una transferencia de un lote.
      if (pdf.numPages !== 1) return null;
      const page = await pdf.getPage(1);
      const size = page.getViewport({ scale: 1 });
      const scale = Math.min(4, 2600 / size.width, 3600 / size.height);
      const image = await renderPageAsImage(pdf, 1, { scale, canvasImport: () => import("@napi-rs/canvas") });
      if (cancelled) return null;
      worker = await createWorker("eng", 1, {
        langPath: join(dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0"),
        workerPath: require.resolve("tesseract.js/src/worker-script/node/index.js"),
        cacheMethod: "none",
        errorHandler: () => {},
      });
      if (cancelled) { await worker.terminate(); return null; }
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, user_defined_dpi: "300" });
      const { data } = await worker.recognize(Buffer.from(image), {}, { text: true, blocks: true });
      const read = parseBacTransfer(data.text);
      if (!read) return null;
      const words = data.blocks?.flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words))) ?? [];
      const confident = (value: string) => words.some(w => w.text.replace(/[,\s]/g, "") === value.replace(/[,\s]/g, "") && w.confidence >= 80);
      // Una lectura borrosa no rellena cifras por aproximación.
      if (read.reference.value && !confident(read.reference.value)) read.reference = { value: null, evidence: null, certainty: "uncertain" };
      if (read.original_amount.value && !confident(read.original_amount.value)) {
        read.usd_amount = { value: null, evidence: null, certainty: "uncertain" };
        read.original_amount = { value: null, evidence: null, certainty: "uncertain" };
      }
      if (read.date.value && !confident(read.date.value.split("-").reverse().join("/"))) read.date = { value: null, evidence: null, certainty: "uncertain" };
      if (read.original_currency.value && !confident(read.original_currency.value)) {
        read.original_currency = { value: null, evidence: null, certainty: "uncertain" };
        read.usd_amount = { value: null, evidence: null, certainty: "uncertain" };
      }
      read.warnings.unshift("PDF leído con OCR. Revisa cada cifra y referencia contra la imagen antes de guardar.");
      return read;
    };
    return await Promise.race([work(), new Promise<null>(resolve => { timer = setTimeout(() => { cancelled = true; resolve(null); }, 35_000); })]);
  } catch { return null; }
  finally {
    cancelled = true;
    clearTimeout(timer);
    await worker?.terminate().catch(() => {});
    await pdf?.loadingTask.destroy().catch(() => {});
    busy = false;
  }
}
