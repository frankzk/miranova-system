// Solo contra el servidor local de fixtures. No usa secretos ni movimientos reales.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const base = "http://localhost:3100";
const cookies = {};
for (const username of ["dueno", "andrea", "analista"]) {
  const res = await fetch(`${base}/api/login`, {
    method: "POST",
    redirect: "manual",
    body: new URLSearchParams({ username, password: "demo1234" }),
  });
  assert.equal(res.status, 303);
  cookies[username] = res.headers.get("set-cookie").split(";")[0];
}
async function page(user, path = "/reconciliation") {
  const res = await fetch(base + path, { headers: { Cookie: cookies[user] } });
  return { res, text: (await res.text()).replaceAll('\\"', '"') };
}
assert.equal(
  (
    await fetch(
      `${base}/api/reconciliation/document/b0000000-0000-4000-8000-000000000001`,
    )
  ).status,
  401,
);
for (const user of ["andrea", "analista"]) {
  const result = await page(user);
  assert.ok(
    result.res.url.includes("sin-acceso") ||
      result.text.includes("NEXT_REDIRECT"),
  );
  assert.ok(!result.text.includes("DEMO-1"));
  assert.equal(
    (
      await page(
        user,
        "/api/reconciliation/document/b0000000-0000-4000-8000-000000000001",
      )
    ).res.status,
    403,
  );
}
const owner = await page("dueno");
assert.equal(owner.res.status, 200);
assert.ok(owner.text.includes("DEMO-1"));
assert.ok(!owner.text.includes('"reference":"DEMO-6"'));
const other = await page("dueno", "/reconciliation?company=mireva");
assert.ok(other.text.includes("DEMO-6"));
assert.ok(!other.text.includes('"reference":"DEMO-1"'));
console.log("PASS: page and document access; companies separated");

const manifest = JSON.parse(
  readFileSync(".next/dev/server/server-reference-manifest.json", "utf8"),
);
const actions = Object.fromEntries(
  Object.entries(manifest.node).map(([key, value]) => [
    value.exportedName,
    key,
  ]),
);
async function call(user, name, fields, args) {
  assert.ok(actions[name], `Action missing: ${name}`);
  const body = new FormData();
  if (args) body.set("0", JSON.stringify(args));
  else {
    for (const [k, v] of Object.entries(fields)) body.set(`_1_${k}`, String(v));
    body.set("0", '[null,"$K1"]');
  }
  const res = await fetch(`${base}/reconciliation`, {
    method: "POST",
    body,
    headers: {
      Cookie: cookies[user],
      Origin: base,
      "Next-Action": actions[name],
      Accept: "text/x-component",
    },
  });
  const text = await res.text();
  const match = text.match(/\d+:(\{"ok":(?:true|false),.*\})/);
  assert.ok(
    match,
    `Missing result for ${name}: ${res.status}, ${text.slice(-400)}`,
  );
  return JSON.parse(match[1]);
}
for (const user of ["andrea", "analista"]) {
  for (const name of [
    "saveBankEntry",
    "reconcileBank",
    "reverseBankMatch",
    "voidBankEntry",
  ]) {
    const result = await call(user, name, {});
    assert.equal(result.ok, false);
    assert.match(result.msg, /permiso/);
  }
  assert.equal(
    (await call(user, "prepareBankPdf", {}, ["miranova", "qa.pdf", 200])).ok,
    false,
  );
  assert.equal(
    (await call(user, "readBankPdf", {}, ["miranova", "miranova/forged.pdf"]))
      .ok,
    false,
  );
}
console.log(
  "PASS: direct server actions and PDF uploads require reconciliation permission",
);

const suffix = Date.now();
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Lima",
}).format(new Date());
const fields = {
  company: "miranova",
  source: "mercury",
  reference: `QA-BANK-${suffix}`,
  occurred_on: today,
  amount: "512.29",
  counterparty: "Boxful QA",
  bank_account: "Checking QA",
};
const saved = await call("dueno", "saveBankEntry", fields);
assert.equal(saved.ok, true, saved.msg);
assert.ok((await page("dueno")).text.includes(fields.reference));
assert.equal(
  (await call("dueno", "saveBankEntry", { ...fields, amount: "512.291" })).ok,
  false,
);

const boxful = {
  ...fields,
  source: "boxful",
  reference: `QA-PDF-${suffix}`,
  amount: "1000.00",
  original_currency: "GTQ",
  original_amount: "7750.00",
};
assert.equal((await call("dueno", "saveBankEntry", boxful)).ok, false);
const pdf = new Blob(
  ["%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"],
  { type: "application/pdf" },
);
const prepared = await call("dueno", "prepareBankPdf", {}, [
  "miranova",
  "qa-bank.pdf",
  pdf.size,
]);
assert.ok(prepared.ok);
const body = new FormData();
body.set("", pdf, "qa-bank.pdf");
assert.equal(
  (await fetch(base + prepared.url, { method: "PUT", body })).status,
  200,
);
const proposed = await call("dueno", "readBankPdf", {}, [
  "miranova",
  prepared.path,
]);
assert.equal(proposed.ok, true, proposed.msg);
assert.equal(proposed.proposal.fields.reference, "BOXFUL-DEMO-104");
assert.equal(proposed.proposal.fields.occurred_on, "2026-10-28");
assert.equal(proposed.proposal.fields.amount, "6377.06");
assert.ok(
  !(await page("dueno")).text.includes('"reference":"BOXFUL-DEMO-104"'),
  "Reading saved a transfer without confirmation",
);
for (const args of [
  ["mireva", prepared.path],
  [
    "miranova",
    prepared.path.replace(
      /\/[a-f0-9-]{36}\//,
      "/a0000000-0000-4000-8000-000000000002/",
    ),
  ],
  ["miranova", "../forged.pdf"],
])
  assert.equal((await call("dueno", "readBankPdf", {}, args)).ok, false);
console.log(
  "PASS: PDF proposal without saving; wrong company, owner and path rejected",
);
const pdfSaved = await call("dueno", "saveBankEntry", {
  ...boxful,
  document_path: prepared.path,
  document_name: "qa-bank.pdf",
});
assert.equal(pdfSaved.ok, true, pdfSaved.msg);
const pdfPage = (await page("dueno")).text;
const document = pdfPage.match(
  new RegExp(
    '"id":"([a-f0-9-]{36})"[^{}]*"reference":"' + boxful.reference + '"',
  ),
);
assert.ok(document);
const docRes = await fetch(
  `${base}/api/reconciliation/document/${document[1]}`,
  { headers: { Cookie: cookies.dueno }, redirect: "manual" },
);
assert.equal(docRes.status, 302);
assert.equal(docRes.headers.get("cache-control"), "private, no-store");
const file = await fetch(base + docRes.headers.get("location"));
assert.equal(await file.text(), await pdf.text());
console.log(
  "PASS: manual Mercury registration; Boxful PDF upload, verification and protected download",
);

const pair = {
  company: "miranova",
  boxful_id: "b0000000-0000-4000-8000-000000000002",
  mercury_id: "b0000000-0000-4000-8000-000000000004",
  boxful_version: 1,
  mercury_version: 1,
  fee: "20.00",
  fee_note: "QA wire fee",
  confirmed: "on",
};
assert.equal(
  (await call("dueno", "reconcileBank", { ...pair, confirmed: "" })).ok,
  false,
);
assert.equal(
  (await call("dueno", "reconcileBank", { ...pair, fee: "19.99" })).ok,
  false,
);
assert.equal(
  (await call("dueno", "reconcileBank", { ...pair, fee_note: "" })).ok,
  false,
);
assert.equal(
  (
    await call("dueno", "reconcileBank", {
      ...pair,
      mercury_id: "b0000000-0000-4000-8000-000000000007",
    })
  ).ok,
  false,
);
assert.equal(
  (await call("dueno", "reconcileBank", { ...pair, boxful_version: 99 })).ok,
  false,
);
const match = await call("dueno", "reconcileBank", pair);
assert.equal(match.ok, true, match.msg);
console.log(
  "PASS: explicit confirmation, exact commission, support, stale versions and company validation",
);
const afterMatch = (await page("dueno")).text;
const savedMatch = afterMatch.match(
  new RegExp(
    '"id":"([a-f0-9-]{36})"[^{}]*"boxful_id":"' + pair.boxful_id + '"',
  ),
);
assert.ok(savedMatch);
assert.equal(
  (
    await call("dueno", "reverseBankMatch", {
      company: "miranova",
      id: savedMatch[1],
      reason: "QA completada",
    })
  ).ok,
  true,
);
for (const reference of [boxful.reference, fields.reference]) {
  const record = afterMatch.match(
    new RegExp('"id":"([a-f0-9-]{36})"[^{}]*"reference":"' + reference + '"'),
  );
  assert.ok(record);
  assert.equal(
    (
      await call("dueno", "voidBankEntry", {
        company: "miranova",
        id: record[1],
        version: 1,
        reason: "Registro sintético de QA completada",
      })
    ).ok,
    true,
  );
}
console.log(
  "PASS: reversal and void forms; successful QA entries removed from pending lists",
);

const moveFields = { ...fields, reference: `QA-MOVE-${suffix}`, notes: "Empresa por confirmar. Registro provisional de prueba." };
assert.equal((await call("dueno", "saveBankEntry", moveFields)).ok, true);
const movePage = (await page("dueno")).text;
const moveId = movePage.match(new RegExp('"id":"([a-f0-9-]{36})"[^{}]*"reference":"' + moveFields.reference + '"'))?.[1];
assert.ok(moveId);
const move = { ...moveFields, id: moveId, version: "1", target_company: "mireva", company_reason: "Empresa verificada en comprobante", company_confirmed: "on" };
assert.equal((await call("dueno", "saveBankEntry", { ...move, company_confirmed: "" })).ok, false);
assert.equal((await call("dueno", "saveBankEntry", { ...move, company_reason: "" })).ok, false);
assert.equal((await call("dueno", "saveBankEntry", { ...move, target_company: "INVALID" })).ok, false);
assert.equal((await call("andrea", "saveBankEntry", move)).ok, false);
const moved = await call("dueno", "saveBankEntry", move);
assert.equal(moved.ok, true, moved.msg);
const movedPage = (await page("dueno", "/reconciliation?company=mireva")).text;
assert.ok(movedPage.includes(moveId));
assert.ok(movedPage.includes(moveFields.reference));
assert.ok(movedPage.includes("Cambio de empresa: miranova"));
assert.equal((await call("dueno", "saveBankEntry", move)).ok, false, "stale source/version rejected");
assert.equal((await call("dueno", "voidBankEntry", { company: "mireva", id: moveId, version: "2", reason: "QA completada" })).ok, true);
console.log("PASS: Mercury company change requires permission, explicit confirmation, reason and current version");
