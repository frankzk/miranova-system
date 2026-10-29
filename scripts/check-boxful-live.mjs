// Opt-in live smoke test: only accepts the named synthetic fixture, never a customer PDF.
// Run with existing project credentials; does not print tokens or write financial records.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { readBoxfulDocument } from "../lib/boxful-pdf.ts";
const path = process.argv[2];
assert.equal(basename(path || ""), "boxful-autofill-test.pdf");
delete process.env.MIRANOVA_FIXTURES;
globalThis.fetch = () => { throw new Error("Direct PDF extraction must not need a network request"); };
const result = await readBoxfulDocument(readFileSync(path), null, "synthetic-test", "2026-10-29");
if (!result.ok) { console.log(JSON.stringify(result)); process.exitCode = 1; }
else {
  assert.equal(result.proposal.fields.reference, "BOXFUL-DEMO-104");
  assert.equal(result.proposal.fields.occurred_on, "2026-10-28");
  assert.equal(result.proposal.fields.amount, "6377.06");
  console.log(JSON.stringify({ ok: true, fields: result.proposal.fields, warnings: result.proposal.warnings }));
}
