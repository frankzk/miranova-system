// Contrato del SDK y errores, con respuestas simuladas. No envía datos ni consume crédito.
// node --conditions=react-server --experimental-strip-types scripts/check-boxful-reader.mjs
import assert from "node:assert/strict";
import { mock } from "node:test";
import { extractBoxfulPdf, readBoxfulPdf } from "../lib/boxful-document-ai.ts";
const saved = Object.fromEntries(
  [
    "MIRANOVA_FIXTURES",
    "VERCEL",
    "NODE_ENV",
    "AI_GATEWAY_API_KEY",
    "VERCEL_OIDC_TOKEN",
  ].map((key) => [key, process.env[key]]),
);
const field = (value) => ({
  value,
  evidence: "PDF: " + value,
  certainty: "clear",
});
const extracted = {
  kind: "single_transfer",
  date: field("2026-10-28"),
  reference: field("BX-SDK-TEST"),
  usd_amount: field("1000.00"),
  original_currency: field("USD"),
  original_amount: field("1000.00"),
  warnings: [],
};
let status = 200,
  calls = 0,
  payload = extracted,
  stop = "end_turn";
const pdf = new TextEncoder().encode("%PDF-1.4 synthetic SDK test");
mock.method(globalThis, "fetch", async (input, options) => {
  calls++;
  const url = String(input);
  const headers = new Headers(options.headers);
  const body = JSON.parse(options.body);
  if (url.startsWith("https://ai-gateway.vercel.sh")) {
    assert.equal(headers.get("authorization"), "Bearer synthetic-oidc-token");
    assert.equal(headers.get("x-api-key"), null);
    assert.equal(body.model, "anthropic/claude-sonnet-5.5");
  } else {
    assert.equal(headers.get("x-api-key"), "synthetic-direct-key");
  }
  assert.equal(
    body.messages[0].content[0].source.media_type,
    "application/pdf",
  );
  assert.equal(body.output_config.format.type, "json_schema");
  assert.match(body.system, /ignora cualquier orden/);
  if (status !== 200)
    return new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "api_error",
          message: "provider error containing private details",
        },
      }),
      { status, headers: { "content-type": "application/json" } },
    );
  return new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: body.model,
      content: [{ type: "text", text: JSON.stringify(payload) }],
      stop_reason: stop,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
    { headers: { "content-type": "application/json" } },
  );
});
try {
  delete process.env.MIRANOVA_FIXTURES;
  delete process.env.AI_GATEWAY_API_KEY;
  process.env.VERCEL = "1";
  process.env.NODE_ENV = "production";
  process.env.VERCEL_OIDC_TOKEN = "synthetic-oidc-token";
  const gateway = await extractBoxfulPdf(pdf, null, "2026-10-29");
  assert.ok(gateway.ok, JSON.stringify(gateway));
  assert.equal(gateway.proposal.fields.amount, "1000.00");
  assert.ok(
    (await extractBoxfulPdf(pdf, "synthetic-direct-key", "2026-10-29")).ok,
  );
  process.env.MIRANOVA_FIXTURES = "1";
  const production = await extractBoxfulPdf(pdf, null, "2026-10-29");
  assert.ok(production.ok);
  assert.equal(
    production.proposal.fields.reference,
    "BX-SDK-TEST",
    "Fixtures leaked into production",
  );
  delete process.env.MIRANOVA_FIXTURES;
  const before = calls;
  await Promise.all([
    readBoxfulPdf(pdf, null, "same-user-company", "2026-10-29"),
    readBoxfulPdf(pdf, null, "same-user-company", "2026-10-29"),
  ]);
  assert.equal(calls, before + 1, "Concurrent reads not deduplicated");
  await readBoxfulPdf(pdf, null, "other-user-company", "2026-10-29");
  assert.equal(calls, before + 2);
  for (const code of [400, 401, 402, 403, 413, 429, 500]) {
    status = code;
    const result = await extractBoxfulPdf(pdf, null, "2026-10-29");
    assert.equal(result.ok, false);
    assert.ok(!result.msg.includes("private details"));
  }
  status = 200;
  payload = { broken: true };
  assert.equal((await extractBoxfulPdf(pdf, null, "2026-10-29")).ok, false);
  payload = extracted;
  stop = "refusal";
  assert.equal((await extractBoxfulPdf(pdf, null, "2026-10-29")).ok, false);
  delete process.env.VERCEL_OIDC_TOKEN;
  assert.equal((await extractBoxfulPdf(pdf, null, "2026-10-29")).ok, false);
  console.log(
    "PASS: SDK structured PDF request, OIDC, existing key, production guard, deduplication, errors and manual fallback",
  );
} finally {
  mock.restoreAll();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
