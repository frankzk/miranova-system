import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, customDays, customLabels, MAX_CUSTOM_DAYS, parseYmd, rangeQuery, resolveRange } from "./ranges.ts";

const TODAY = "2026-09-28";

test("fechas válidas del calendario", () => {
  assert.equal(parseYmd("2026-09-15"), "2026-09-15");
  assert.equal(parseYmd(" 2026-02-28 "), "2026-02-28");
  assert.equal(parseYmd("2026-02-30"), null);
  assert.equal(parseYmd("15/09/2026"), null);
  assert.equal(parseYmd(""), null);
  assert.equal(parseYmd(undefined), null);
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
});

test("rango propio: ordena, no pasa de hoy ni del máximo", () => {
  assert.deepEqual(customDays("2026-09-01", "2026-09-15", TODAY), { from: "2026-09-01", to: "2026-09-15" });
  // al revés
  assert.deepEqual(customDays("2026-09-15", "2026-09-01", TODAY), { from: "2026-09-01", to: "2026-09-15" });
  // solo "desde": hasta hoy; solo "hasta": ese día
  assert.deepEqual(customDays("2026-09-20", undefined, TODAY), { from: "2026-09-20", to: TODAY });
  assert.deepEqual(customDays(undefined, "2026-09-10", TODAY), { from: "2026-09-10", to: "2026-09-10" });
  // futuro → hoy
  assert.deepEqual(customDays("2026-09-25", "2026-10-10", TODAY), { from: "2026-09-25", to: TODAY });
  assert.deepEqual(customDays("2026-10-01", "2026-10-05", TODAY), { from: TODAY, to: TODAY });
  // demasiado largo → se recorta el inicio
  const long = customDays("2020-01-01", TODAY, TODAY)!;
  assert.equal(long.to, TODAY);
  assert.equal(long.from, addDays(TODAY, -(MAX_CUSTOM_DAYS - 1)));
  // sin fechas válidas
  assert.equal(customDays("x", "", TODAY), null);
  assert.equal(customDays(undefined, undefined, TODAY), null);
});

test("textos del rango propio", () => {
  assert.deepEqual(customLabels("2026-09-15", "2026-09-28", TODAY), { short: "15 – 28 sep", during: "del 15 al 28 sep" });
  assert.deepEqual(customLabels("2026-08-30", "2026-09-05", TODAY), { short: "30 ago – 5 sep", during: "del 30 ago al 5 sep" });
  assert.deepEqual(customLabels("2026-09-15", "2026-09-15", TODAY), { short: "15 sep", during: "el 15 sep" });
  assert.deepEqual(customLabels("2025-12-20", "2026-01-05", TODAY), { short: "20 dic 2025 – 5 ene", during: "del 20 dic 2025 al 5 ene" });
});

test("resolveRange: rango propio, días completos en la zona de la cuenta", () => {
  const r = resolveRange(undefined, "America/Tegucigalpa", { from: "2026-09-01", to: "2026-09-15" });
  assert.equal(r.id, "custom");
  assert.equal(r.bucket, "day");
  // Honduras es UTC−6: el 1 de sep empieza a las 06:00 UTC y el 15 termina justo antes del 16 a las 06:00 UTC
  assert.equal(r.from.toISOString(), "2026-09-01T06:00:00.000Z");
  assert.equal(r.to.toISOString(), "2026-09-16T05:59:59.999Z");
  assert.equal(rangeQuery(r), "from=2026-09-01&to=2026-09-15");
  // un solo día → por hora
  assert.equal(resolveRange(undefined, "America/Tegucigalpa", { from: "2026-09-10", to: "2026-09-10" }).bucket, "hour");
});

test("resolveRange: sin fechas propias usa los períodos de siempre", () => {
  const tz = "America/Tegucigalpa";
  assert.equal(resolveRange("7", tz).id, "7");
  assert.equal(resolveRange("7", tz).during, "en 7 días");
  assert.equal(resolveRange("hoy", tz).during, "hoy");
  assert.equal(resolveRange("otro", tz).id, "30");
  assert.equal(resolveRange("7", tz, { from: "", to: "" }).id, "7");
  assert.equal(rangeQuery(resolveRange("30", tz)), "");
  assert.equal(rangeQuery(resolveRange("ayer", tz)), "r=ayer");
});
