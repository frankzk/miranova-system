import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bankCandidates,
  cents,
  cleanBankFields,
  matchProblem,
  referenceKey,
  validBankDay,
  type BankEntry,
  type BankMatch,
} from "./reconciliation.ts";

const base = {
  company: "miranova",
  source: "boxful",
  reference: " BX-42 ",
  occurred_on: "2026-10-28",
  amount: "6377.06",
  original_currency: "USD",
};
const entry = (
  id: string,
  source: "boxful" | "mercury",
  amount = 637706,
): BankEntry =>
  ({
    id,
    source,
    company: "miranova",
    reference: id,
    occurred_on: "2026-10-28",
    amount_cents: amount,
    original_currency: "USD",
    original_amount_cents: amount,
    version: 1,
    void_reason: null,
  }) as BankEntry;

test("centavos exactos: sin redondeo, exponentes, signos ni separadores ambiguos", () => {
  assert.equal(cents("6377.06"), 637706);
  assert.equal(cents("0.29"), 29);
  assert.equal(cents("0"), 0);
  assert.equal(cents("12.5"), 1250);
  for (const value of [
    "",
    "1.001",
    "1e3",
    "-5",
    "1,000.00",
    "1,25",
    "Infinity",
    "NaN",
    "9999999999999",
  ])
    assert.equal(cents(value), null, value);
});
test("PDF en otra moneda: exige monto original y USD explícito; Mercury siempre es USD", () => {
  const valid = cleanBankFields({
    ...base,
    original_currency: "HNL",
    original_amount: "160000.00",
  });
  assert.ok(valid.ok);
  assert.equal(valid.row.amount_cents, 637706);
  assert.equal(valid.row.original_amount_cents, 16000000);
  assert.equal(
    cleanBankFields({ ...base, original_currency: "GTQ" }).ok,
    false,
  );
  const mercury = cleanBankFields({
    ...base,
    source: "mercury",
    original_currency: "HNL",
    original_amount: "2",
    counterparty: "Boxful",
    bank_account: "Checking 0000",
  });
  assert.ok(mercury.ok);
  assert.equal(mercury.row.original_currency, "USD");
  assert.equal(mercury.row.original_amount_cents, 637706);
});
test("registros: fecha real, empresa válida, referencia, importes positivos y cuenta bancaria", () => {
  assert.equal(validBankDay("2026-02-30"), false);
  assert.equal(validBankDay("2024-02-29"), true);
  const patches: Record<string, string>[] = [
    { company: "otra" },
    { source: "otro" },
    { reference: "" },
    { amount: "0" },
    { amount: "1.234" },
    { occurred_on: "bad" },
    { notes: "a".repeat(2001) },
    { source: "mercury" },
  ];
  for (const patch of patches)
    assert.equal(cleanBankFields({ ...base, ...patch }).ok, false);
  assert.equal(referenceKey(" BX-42   TEST "), "bx-42 test");
});
test("cruce exige igualdad al centavo y comisión explícita sustentada", () => {
  const b = entry("b", "boxful", 100000),
    m = entry("m", "mercury", 99750);
  assert.equal(matchProblem(b, m, 250, "Wire fee, comprobante 42"), null);
  assert.match(matchProblem(b, m, 249, "soporte")!, /No cuadra/);
  assert.match(matchProblem(b, m, 250, " ")!, /Explica/);
  assert.match(matchProblem(b, m, -250, "soporte")!, /positiv/);
  assert.match(
    matchProblem(b, { ...m, company: "mireva" }, 250, "soporte")!,
    /empresas/,
  );
  assert.match(
    matchProblem(b, { ...m, void_reason: "error" }, 250, "soporte")!,
    /anulado/,
  );
  assert.match(
    matchProblem(b, entry("r", "mercury", 100001), 0, "")!,
    /No cuadra/,
  );
  assert.equal(matchProblem(b, entry("same", "mercury", 100000), 0, ""), null);
});
test("candidatos: excluye empresas, anulados y abonos usados; conserva importes iguales ambiguos", () => {
  const b = entry("b", "boxful");
  const exact = entry("exact", "mercury"),
    another = entry("another", "mercury"),
    fee = entry("fee", "mercury", 635706);
  const used = entry("used", "mercury"),
    foreign = { ...entry("foreign", "mercury"), company: "mireva" as const },
    voided = { ...entry("voided", "mercury"), void_reason: "error" };
  const active = { mercury_id: used.id, reversed_at: null } as BankMatch;
  assert.deepEqual(
    bankCandidates(
      b,
      [fee, used, foreign, voided, b, exact, another],
      [active],
    ).map((e) => e.id),
    ["exact", "another", "fee"],
  );
  assert.equal(
    bankCandidates(b, [used], [{ ...active, reversed_at: "2026-10-28" }])
      .length,
    1,
  );
});

test("desde Mercury solo ofrece transferencias Boxful sin vincular de su empresa", () => {
  const mercury = entry("m", "mercury", 100000);
  const exact = entry("exact", "boxful", 100000);
  const commission = entry("commission", "boxful", 102000);
  const used = entry("used", "boxful", 100000);
  const anotherCompany = { ...entry("foreign", "boxful"), company: "mireva" as const };
  const voided = { ...entry("void", "boxful"), void_reason: "Error" };
  const match = { boxful_id: used.id, mercury_id: "another-abono", reversed_at: null } as BankMatch;
  const rows = [commission, anotherCompany, used, exact, mercury, voided];
  assert.deepEqual(bankCandidates(mercury, rows, [match]).map((record) => record.id), ["exact", "commission"]);
  assert.equal(bankCandidates(mercury, [used], [{ ...match, reversed_at: "2026-10-29" }]).length, 1);
  assert.equal(bankCandidates({ ...mercury, void_reason: "Error" }, rows, []).length, 0);
});
