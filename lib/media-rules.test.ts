import { strict as assert } from "node:assert";
import { test } from "node:test";
import { downloadName, fmtBytes, isMediaKey, isPathForKey, mediaFolder, mediaKey, mediaProblem, mediaType } from "./media-rules.ts";
import { normalizePermissions } from "./permissions.ts";

const ACC = "11111111-1111-4111-8111-111111111111";

test("mediaKey agrupa por SKU sin importar país ni mayúsculas", () => {
  assert.equal(mediaKey({ sku: " abc-12 ", account_id: ACC, external_id: "9" }), "sku:ABC-12");
  assert.equal(mediaKey({ sku: "ABC-12", account_id: "otra", external_id: "1" }), "sku:ABC-12");
  assert.equal(mediaKey({ sku: "", account_id: ACC, external_id: "9" }), `id:${ACC}:9`);
  assert.equal(mediaKey({ sku: null, account_id: ACC, external_id: "9" }), `id:${ACC}:9`);
});

test("isMediaKey solo acepta claves con la forma esperada", () => {
  assert.ok(isMediaKey("sku:ABC"));
  assert.ok(isMediaKey(`id:${ACC}:77`));
  assert.ok(!isMediaKey("sku:"));
  assert.ok(!isMediaKey("id:no-uuid:1"));
  assert.ok(!isMediaKey(42));
});

test("tipos y tamaños permitidos", () => {
  assert.equal(mediaProblem("image/jpeg", "a.jpg", 1000), null);
  assert.equal(mediaProblem("video/quicktime", "a.mov", 49 * 1024 * 1024), null);
  assert.match(mediaProblem("video/mp4", "a.mp4", 51 * 1024 * 1024)!, /50 MB/);
  assert.match(mediaProblem("application/pdf", "a.pdf", 10)!, /solo fotos/);
  assert.match(mediaProblem("image/png", "a.png", 0)!, /vacío/);
  // sin tipo del navegador, se deduce por extensión; con un tipo distinto, no
  assert.equal(mediaType("", "clip.MOV"), "video/quicktime");
  assert.equal(mediaType("application/octet-stream", "x.jpeg"), "image/jpeg");
  assert.equal(mediaType("text/html", "x.jpg"), null);
});

test("la ruta registrada debe ser de la carpeta de esa clave", () => {
  const key = "sku:AB C/../x";
  const folder = mediaFolder(key);
  assert.ok(!folder.includes("/"));
  const path = `${folder}/0f8fad5b-d9cb-469f-a165-70867728950e.jpg`;
  assert.ok(isPathForKey(path, key));
  assert.ok(!isPathForKey(path, "sku:OTRO"));
  assert.ok(!isPathForKey(`${folder}/../0f8fad5b-d9cb-469f-a165-70867728950e.jpg`, key));
  assert.ok(!isPathForKey(`${folder}/0f8fad5b-d9cb-469f-a165-70867728950e.exe`, key));
});

test("nombres de descarga y tamaños legibles", () => {
  assert.equal(downloadName("Cinturón sin Hebilla / Pack 5", "image/jpeg", 2), "Cinturon-sin-Hebilla-Pack-5-2.jpg");
  assert.equal(downloadName("***", "video/mp4"), "producto.mp4");
  assert.equal(fmtBytes(2048), "2 KB");
  assert.equal(fmtBytes(3.5 * 1024 * 1024), "3.5 MB");
});

test("el permiso Fotos incluye ver Productos", () => {
  assert.deepEqual(normalizePermissions(["photos"]), ["products", "photos"]);
});
