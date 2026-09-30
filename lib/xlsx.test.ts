import assert from "node:assert/strict";
import { test } from "node:test";
import { buildXlsx, colName, crc32 } from "./xlsx.ts";

/** Nombres de archivo del directorio central del ZIP. */
function entries(zip: Uint8Array): string[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = zip.length - 22;
  while (end >= 0 && v.getUint32(end, true) !== 0x06054b50) end--;
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    assert.equal(v.getUint32(p, true), 0x02014b50);
    const len = v.getUint16(p + 28, true);
    out.push(new TextDecoder().decode(zip.subarray(p + 46, p + 46 + len)));
    p += 46 + len + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  return out;
}

test("columnas de Excel y CRC32", () => {
  assert.equal(colName(0), "A");
  assert.equal(colName(25), "Z");
  assert.equal(colName(26), "AA");
  assert.equal(colName(701), "ZZ");
  assert.equal(colName(702), "AAA");
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("libro con dos hojas: ZIP válido, textos escapados y sin fórmulas", () => {
  const book = buildXlsx([
    { name: "Tiendas", columns: [{ header: "Tienda" }, { header: "Pedidos" }], rows: [["Café & <Té> \"x\"", 12], ["=HYPERLINK(1)", null]] },
    { name: "Tiendas", columns: [{ header: "Nombre" }], rows: [] },
  ]);
  assert.equal(new DataView(book.buffer).getUint32(0, true), 0x04034b50);
  assert.deepEqual(entries(book), [
    "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml",
    "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml",
  ]);
  const text = new TextDecoder().decode(book);
  assert.match(text, /Café &amp; &lt;Té&gt; &quot;x&quot;/);
  // "=…" va como texto, no como fórmula
  assert.match(text, /t="inlineStr"><is><t xml:space="preserve">=HYPERLINK\(1\)<\/t>/);
  assert.doesNotMatch(text, /<f>/);
  assert.match(text, /<c r="B2"><v>12<\/v><\/c>/);
  // nombres de hoja repetidos se distinguen
  assert.match(text, /<sheet name="Tiendas" sheetId="1"/);
  assert.match(text, /<sheet name="Tiendas 2" sheetId="2"/);
});
