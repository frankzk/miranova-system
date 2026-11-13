import assert from "node:assert/strict";
import { test } from "node:test";
import type { BankEntry, BankMatch } from "./reconciliation.ts";
import {
  daysBetween, money, signedUsd,
  expectedUsdCents, loosePdfs, mercuryCandidates, pdfCandidates, referenceMatches, referenceParts, settlementViews,
  type Settlement,
} from "./settlements.ts";

const settlement = (o: Partial<Settlement> = {}): Settlement => ({
  id: "s1", company: "miranova", source: "drop", account_id: "a1", external_id: "x1", reference: "ILGA5JTC",
  confirmation: "2355766", operation: "miranova", country: "HN", requested_at: "2026-11-05T02:14:19Z", requested_on: "2026-11-04",
  status: "paid", status_label: "Liquidada", failure_reason: "", currency: "HNL", amount_cents: 36_300_000, usd_rate: 0.0388581101,
  usd_amount_cents: null, bank: "Choice Financial Group", bank_account: "202****277",
  evidence: [], boxful_id: null, linked_by: null, linked_at: null, reviewed_by: null, reviewed_at: null, review_note: null, ...o,
});

let n = 0;
const entry = (o: Partial<BankEntry>): BankEntry => ({
  id: `e${++n}`, company: "miranova", source: "boxful", reference: "REF", occurred_on: "2026-11-04", amount_cents: 100,
  original_currency: "USD", original_amount_cents: 100, counterparty: "Boxful", bank_account: "0277", notes: "",
  document_path: "p", document_name: "x.pdf", document_sha256: "a".repeat(64), created_by: "u", updated_by: "u",
  created_at: "2026-11-04T00:00:00Z", updated_at: "2026-11-04T00:00:00Z", version: 1, void_reason: null,
  origin_operation: null, origin_country: null, ...o,
});

test("monto esperado en USD con la tasa de la plataforma", () => {
  assert.equal(expectedUsdCents(settlement()), 1_410_549);
  assert.equal(expectedUsdCents(settlement({ currency: "USD", amount_cents: 500_000, usd_rate: null })), 500_000);
  assert.equal(expectedUsdCents(settlement({ usd_rate: null })), null);
  // si la plataforma informa lo enviado en USD, manda eso
  assert.equal(expectedUsdCents(settlement({ usd_amount_cents: 1_408_549 })), 1_408_549);
});

test("referencia: la de Drop o una de las varias de Boxful", () => {
  assert.deepEqual(referenceParts("2352476-2353166-2352659"), ["2352476", "2353166", "2352659"]);
  assert.deepEqual(referenceParts("ILGA5JTC"), ["ilga5jtc"]);
  const boxful = settlement({ reference: "2352476-2353166-2352477-2352478-2352659-2354676-42401306" });
  assert.equal(referenceMatches(boxful, entry({ reference: "2352659" })), true);
  assert.equal(referenceMatches(boxful, entry({ reference: "Miranova HN" })), false);
  assert.equal(referenceMatches(settlement(), entry({ reference: "Miranova HN", notes: "Liquidación ILGA5JTC" })), true);
  // el número de confirmación de Drop es la referencia del PDF de Boxful/BAC
  assert.equal(referenceMatches(settlement(), entry({ reference: "2355766" })), true);
  // un número que solo contiene a otro no cuenta
  assert.equal(referenceMatches(settlement({ reference: "2352659" }), entry({ reference: "23526590" })), false);
});

test("comprobante: por referencia, por monto original o por monto y fecha; fuera otra operación o país", () => {
  const hn = entry({ reference: "Miranova HN", amount_cents: 1_408_549, origin_operation: "miranova", origin_country: "HN" });
  const sv = entry({ reference: "Miranova SV", amount_cents: 1_408_549, origin_operation: "miranova", origin_country: "SV" });
  const late = entry({ reference: "Viejo", amount_cents: 1_408_549, occurred_on: "2026-12-30" });
  const other = entry({ reference: "Otro", amount_cents: 300_00 });
  const c = pdfCandidates(settlement(), [hn, sv, late, other], new Set());
  assert.deepEqual(c.map((x) => x.entry.id), [hn.id]);
  assert.equal(c[0].strong, true);
  assert.equal(c[0].diffCents, -2000);
  // mismo monto en la moneda original
  const orig = entry({ reference: "Z", amount_cents: 1, original_currency: "HNL", original_amount_cents: 36_300_000 });
  assert.equal(pdfCandidates(settlement(), [orig], new Set())[0].reason, "Mismo monto en HNL");
  // ya usado en otra liquidación: no se propone
  assert.equal(pdfCandidates(settlement(), [hn], new Set([hn.id])).length, 0);
  // dos parecidos: ninguno "fuerte", elige la persona
  const twin = entry({ reference: "Miranova HN 2", amount_cents: 1_409_000 });
  assert.equal(pdfCandidates(settlement(), [hn, twin], new Set()).every((x) => !x.strong), true);
});

test("Mercury: mismo monto y fecha cercana es fuerte solo si es único", () => {
  const pdf = entry({ reference: "Miranova HN", amount_cents: 1_408_549 });
  const m1 = entry({ source: "mercury", reference: "M1", amount_cents: 1_408_549, occurred_on: "2026-11-05" });
  const m2 = entry({ source: "mercury", reference: "M2", amount_cents: 1_000_000 });
  const c = mercuryCandidates(pdf, [pdf, m1, m2], []);
  assert.equal(c[0].entry.id, m1.id);
  assert.equal(c[0].strong, true);
  assert.equal(c[1].strong, false);
});

test("pasos de cada liquidación", () => {
  const pdf = entry({ reference: "Miranova HN", amount_cents: 1_408_549 });
  const mer = entry({ source: "mercury", reference: "M1", amount_cents: 1_408_549, occurred_on: "2026-11-05" });
  const match = { id: "m", company: "miranova", boxful_id: pdf.id, mercury_id: mer.id, reversed_at: null, mercury_snapshot: mer } as unknown as BankMatch;
  const steps = (s: Settlement, es: BankEntry[], ms: BankMatch[] = []) => settlementViews([s], es, ms)[0].step;
  assert.equal(steps(settlement({ status: "rejected" }), []), "review");
  assert.equal(steps(settlement({ status: "rejected", reviewed_at: "x" }), []), "reviewed");
  assert.equal(steps(settlement({ status: "pending" }), []), "waiting_platform");
  assert.equal(steps(settlement(), []), "needs_pdf");
  assert.equal(steps(settlement(), [pdf]), "confirm_pdf");
  assert.equal(steps(settlement({ boxful_id: pdf.id }), [pdf]), "waiting_mercury");
  assert.equal(steps(settlement({ boxful_id: pdf.id }), [pdf, mer]), "confirm_mercury");
  assert.equal(steps(settlement({ boxful_id: pdf.id }), [pdf, mer], [match]), "closed");
  assert.equal(settlementViews([settlement({ boxful_id: pdf.id })], [pdf, mer], [match])[0].mercury?.id, mer.id);
  // PDF anulado después de vincularlo: vuelve a faltar
  assert.equal(steps(settlement({ boxful_id: pdf.id }), [{ ...pdf, void_reason: "dup" }]), "needs_pdf");
  const bodega = entry({ reference: "Pago Bodega" });
  assert.deepEqual(loosePdfs([settlement({ boxful_id: pdf.id })], [pdf, bodega]).map((e) => e.reference), ["Pago Bodega"]);
  // marcado "no es liquidación": ni suelto ni sugerido
  assert.deepEqual(loosePdfs([], [bodega], new Set([bodega.id])), []);
  assert.equal(settlementViews([settlement()], [pdf], [], new Set([pdf.id]))[0].step, "needs_pdf");
});

test("montos y días", () => {
  assert.equal(money(36_300_000, "HNL"), "L 363,000.00");
  assert.equal(money(1_408_549, "USD"), "US$ 14,085.49");
  assert.equal(money(500, "XYZ"), "XYZ 5.00");
  assert.equal(signedUsd(-2000), "−US$ 20.00");
  assert.equal(signedUsd(150), "+US$ 1.50");
  assert.equal(daysBetween("2026-11-04", "2026-11-13"), 9);
});
