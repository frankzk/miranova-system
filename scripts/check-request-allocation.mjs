// Local synthetic-data QA. Start MIRANOVA_FIXTURES=1 AUTH_SECRET=demo next dev --port 3100.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const base = "http://localhost:3100";
async function login(username) {
  const r = await fetch(base + "/api/login", { method: "POST", redirect: "manual", body: new URLSearchParams({ username, password: "demo1234" }) });
  const cookie = r.headers.get("set-cookie");
  assert.ok(cookie, "Synthetic fixture login required");
  return cookie.split(";")[0];
}
const owner = await login("dueno"), restricted = await login("andrea");
async function page(cookie, url = "/requests?v=todas") {
  const r = await fetch(base + url, { headers: { Cookie: cookie } });
  return { r, text: (await r.text()).replaceAll('\\"', '"') };
}
const initial = await page(owner);
assert.equal(initial.r.status, 200);
assert.ok(initial.text.includes("Total: suma repartida") && initial.text.includes("Llegó a Drop"));
const forbidden = await page(restricted);
assert.ok(forbidden.r.url.includes("sin-acceso") || forbidden.text.includes("NEXT_REDIRECT"));
const manifest = JSON.parse(readFileSync(".next/dev/server/server-reference-manifest.json", "utf8"));
const actions = Object.fromEntries(Object.entries(manifest.node).filter(([, v]) => v.filename?.includes("requests/actions")).map(([id, v]) => [v.exportedName, id]));
async function action(name, fields, cookie = owner) {
  assert.ok(actions[name], `Missing action ${name}`);
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const value of Array.isArray(v) ? v : [v]) body.append(`_1_${k}`, value);
  body.set("0", '[null,"$K1"]');
  const r = await fetch(base + "/requests", { method: "POST", body, headers: { Cookie: cookie, Origin: base, "Next-Action": actions[name], Accept: "text/x-component" } });
  const text = await r.text();
  const match = text.match(/\d+:(\{"ok":(?:true|false),"msg":.*\})/);
  assert.ok(match, `Missing action response ${r.status}`);
  return JSON.parse(match[1]);
}
const token = String(Date.now());
const storeName = "QA reparto " + token, productName = "QA producto reparto " + token;
const fields = { store_name: storeName, countries: ["HN", "GT"], product: [productName], quantity: ["300"],
  country_quantities: [JSON.stringify({ HN: "100", GT: "150" })], requested_at: "2026-10-01" };
assert.equal((await action("saveRequest", fields, restricted)).ok, false);
for (const split of [{ HN: "301" }, { NI: "1" }, { HN: "-1" }]) {
  assert.equal((await action("saveRequest", { ...fields, country_quantities: [JSON.stringify(split)] })).ok, false);
}
assert.equal((await action("saveRequest", { ...fields, country_quantities: ["broken-json"] })).ok, false);
const saved = await action("saveRequest", fields);
assert.equal(saved.ok, true, saved.msg);
const after = (await page(owner)).text;
assert.ok(after.includes('"country_quantities":{"HN":100,"GT":150}'));
assert.ok(after.replace(/<[^>]*>/g, "").includes("50 por repartir"));
const id = after.match(new RegExp('"id":"([a-f0-9-]{36})"[^{}]{0,700}"store_name":"' + storeName + '"'))?.[1];
assert.ok(id, "Created request ID missing");
assert.equal((await action("saveRequest", { ...fields, id, country_quantities: [JSON.stringify({ HN: "100", GT: "200" })] })).ok, true);
for (const status of ["in_progress", "done"]) assert.equal((await action("setRequestStatus", { id, status })).ok, true);
assert.ok((await page(owner, "/requests?v=atendidas")).text.includes(productName));
const openTable = (await page(owner, "/requests")).text.match(/<table class="table rq-demand-table">[\s\S]*?<\/table>/)?.[0] ?? "";
assert.ok(!openTable.includes(productName));
const excel = await fetch(base + "/api/export/requests?v=todas", { headers: { Cookie: owner } });
assert.equal(excel.status, 200);
const bytes = Buffer.from(await excel.arrayBuffer());
assert.ok(bytes.includes(Buffer.from("Total repartido")) && bytes.includes(Buffer.from(productName)));
assert.equal((await fetch(base + "/api/export/requests", { headers: { Cookie: restricted } })).status, 403);
assert.equal((await action("deleteRequest", { id })).ok, true);
console.log("PASS: allocation validation, persistence, editing, statuses, filters, Excel and permissions");
