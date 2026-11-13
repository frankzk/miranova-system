import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanOrigin, guessOrigin, originLabel } from "./bank-origin.ts";

test("operación y país desde la referencia, las notas o el PDF", () => {
  assert.deepEqual(guessOrigin("Miranova SV - Pago Bodega", "Arriendo Bodega El Salvador // Alex // $300"), { operation: "miranova", country: "SV" });
  assert.deepEqual(guessOrigin("Miranova HN", "Solicitud de pago Hn"), { operation: "miranova", country: "HN" });
  assert.deepEqual(guessOrigin("2352659", "MIREVA HONDURAS"), { operation: "mireva", country: "HN" });
  assert.deepEqual(guessOrigin("2600400634", "LIQUIDACION MIREVA CR - 6ACE9BE", "LIQUIDACION MIREVA CR - 6ACE9BE.pdf"), { operation: "mireva", country: "CR" });
  assert.deepEqual(guessOrigin("2333274", "Mireva", "MIREVA LIQ FULFILLMENT HN #6ac43dd.pdf"), { operation: "mireva", country: "HN" });
  assert.deepEqual(guessOrigin("2600233094", "LIQUIDACION MIRANOVA DROOP GT", "Liquidacion MIRANOVA Droop GT.pdf"), { operation: "miranova", country: "GT" });
  // sin país en el texto
  assert.deepEqual(guessOrigin("2347518", "Mireva", "LIQUIDACION FULMILLMENT MIREVA-28-10-2026 (1).pdf"), { operation: "mireva", country: null });
  // "CR" dentro de otra palabra no cuenta; dos operaciones o dos países: no adivina
  assert.deepEqual(guessOrigin("CRÉDITO 123"), { operation: null, country: null });
  assert.deepEqual(guessOrigin("Miranova y Mireva HN y SV"), { operation: null, country: null });
  assert.deepEqual(guessOrigin(null, undefined, ""), { operation: null, country: null });
});

test("etiqueta y validación", () => {
  assert.equal(originLabel("mireva", "HN"), "Mireva · Honduras");
  assert.equal(originLabel("miranova", null), "Miranova");
  assert.equal(originLabel(null, "CR"), "Costa Rica");
  assert.equal(originLabel(null, null), null);
  assert.deepEqual(cleanOrigin("mireva", "cr"), { ok: true, row: { origin_operation: "mireva", origin_country: "CR" } });
  assert.deepEqual(cleanOrigin("", ""), { ok: true, row: { origin_operation: null, origin_country: null } });
  assert.equal(cleanOrigin("otra", "").ok, false);
  assert.equal(cleanOrigin("", "MX").ok, false);
});
