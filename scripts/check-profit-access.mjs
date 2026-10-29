// Run against `MIRANOVA_FIXTURES=1 AUTH_SECRET=demo next dev --port 3100` only.
// All writes target synthetic local records; never uses a production URL or credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const base = `http://localhost:${Number(process.env.MIRANOVA_TEST_PORT || 3100)}`;
const HN = "11111111-1111-4111-8111-111111111111";
const GT = "22222222-2222-4222-8222-222222222222";
const id = "e0000000-0000-4000-8000-000000000001";
const cookies = {};
for (const user of ["costos", "precios", "analista", "andrea", "dueno"]) {
  const res = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual",
    body: new URLSearchParams({ username: user, password: "demo1234" }) });
  assert.equal(res.status, 303);
  const cookie = res.headers.get("set-cookie");
  assert.ok(cookie, `Fixture login failed: ${user}`);
  cookies[user] = cookie.split(";")[0];
}
async function page(user, path) {
  const res = await fetch(base + path, { headers: { Cookie: cookies[user] } });
  return { res, text: (await res.text()).replaceAll('\\"', '"') };
}
const allowed = { costos: "/profit/costs", precios: "/profit/prices", analista: "/profit" };
for (const user of ["costos", "precios", "analista", "andrea"]) {
  for (const path of Object.values(allowed)) {
    const { res, text } = await page(user, path);
    if (allowed[user] === path) {
      assert.equal(new URL(res.url).pathname, path);
      assert.equal(res.status, 200);
      if (user === "costos") assert.ok(!text.includes('"price_community":300'), "Cost response leaked prices");
      if (user === "precios") assert.ok(!text.includes('"unit_cost":3.1'), "Price response leaked costs");
    } else assert.ok(res.url.includes("sin-acceso") || text.includes("NEXT_REDIRECT"), `${user} accessed ${path}`);
  }
  const { res } = await page(user, "/api/export/profit");
  assert.equal(res.status, user === "analista" ? 200 : 403, `Export access: ${user}`);
}
console.log("PASS: page permissions, restricted responses and export authorization");

const manifest = JSON.parse(readFileSync(".next/dev/server/server-reference-manifest.json", "utf8"));
const actions = Object.fromEntries(Object.entries(manifest.node).map(([key, v]) => [v.exportedName, key]));
async function action(user, name, fields) {
  assert.ok(actions[name], `Action was not compiled: ${name}`);
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(`_1_${k}`, v);
  body.set("0", '[null,"$K1"]');
  const res = await fetch(`${base}/profit/costs`, { method: "POST", body,
    headers: { Cookie: cookies[user], Origin: base, "Next-Action": actions[name], Accept: "text/x-component" } });
  const text = await res.text();
  const match = text.match(/\d+:(\{"ok":(?:true|false),"msg":.*\})/);
  assert.ok(match, `Missing action result: ${name}, HTTP ${res.status}`);
  return JSON.parse(match[1]);
}
for (const [user, names] of Object.entries({
  costos: ["saveProductPrices", "deleteProfitProduct"],
  precios: ["saveProfitProduct", "deleteProfitProduct", "linkToProfitProduct"],
  analista: ["saveProfitProduct", "saveProductPrices", "deleteProfitProduct", "linkToProfitProduct"],
  andrea: ["saveProfitProduct", "saveProductPrices", "deleteProfitProduct", "linkToProfitProduct"],
})) for (const name of names) {
  const result = await action(user, name, { id, product_id: id, account_id: HN, product_key: "forged" });
  assert.equal(result.ok, false, `${user} invoked ${name}`);
  assert.match(result.msg, /permiso|Necesitas/);
}
console.log("PASS: forged direct server actions denied for every restricted role");

// Reset synthetic prices so a previously interrupted QA run can be repeated safely.
assert.equal((await action("precios", "saveProductPrices", { id, [`m_${HN}_pc`]: "300", [`m_${HN}_pu`]: "319", [`m_${GT}_pc`]: "95", [`m_${GT}_pu`]: "98.89" })).ok, true);

const costs = { id, name: "Drenaje linfático DLG", cost_currency: "USD", unit_cost: "4.1", import_cost: "0.4", pickup_cost: "0.25",
  [`m_${HN}_collection`]: "",
  [`m_${HN}_carrier`]: "raulito", [`m_${HN}_transfer`]: "0.6", [`m_${HN}_qty`]: "1200", [`m_${GT}_qty`]: "400",
  [`link_${HN}`]: "name:PRODUCTO EXCLUSIVO DLG", [`link_${GT}`]: "name:PRODUCTO EXCLUSIVO DLG",
  [`m_${HN}_pc`]: "999999", [`m_${HN}_pu`]: "999999" };
const costResult = await action("costos", "saveProfitProduct", costs);
assert.equal(costResult.ok, true, costResult.msg);
const afterCosts = (await page("precios", "/profit/prices")).text;
assert.ok(afterCosts.includes('"price_community":300'));
assert.ok(afterCosts.includes('"price_users":319'));
assert.ok(!afterCosts.includes('"price_users":999999'));

assert.equal((await action("precios", "saveProductPrices", { id, unit_cost: "999999", name: "Forged rename",
  [`m_${HN}_pc`]: "301", [`m_${HN}_pu`]: "320", [`m_${GT}_pc`]: "95", [`m_${GT}_pu`]: "98.89" })).ok, true);
const afterPrices = (await page("costos", "/profit/costs")).text;
assert.ok(afterPrices.includes('"unit_cost":4.1'));
assert.ok(!afterPrices.includes("Forged rename"));
const prices = (await page("precios", "/profit/prices")).text;
assert.ok(prices.includes('"price_community":301'));
assert.ok(prices.includes('"price_users":320'));
assert.equal((await action("precios", "saveProductPrices", { id, [`m_${HN}_pc`]: "-2" })).ok, false);
console.log("PASS: saving costs preserves prices, saving prices preserves costs, invalid price rejected");

// Restore the synthetic records for subsequent manual QA.
const hnl = await action("costos", "saveProfitProduct", { ...costs, cost_currency: "HNL", fx_hnl_per_usd: "999", fx_gtq_per_usd: "7.65",
  unit_cost: "62.50", import_cost: "12.50", pickup_cost: "5", [`m_${HN}_transfer`]: "15" });
assert.equal(hnl.ok, true, hnl.msg);
const hnlPage = (await page("costos", "/profit/costs")).text;
assert.ok(hnlPage.includes('"cost_currency":"HNL"'));
assert.ok(hnlPage.includes('"fx_hnl_per_usd":26.3852')); // synchronized fixture quote: 0.0379 USD/HNL
assert.ok(hnlPage.includes('"unit_cost":62.5'));
assert.ok(hnlPage.includes("L62.5"));
assert.ok(hnlPage.includes("$2.84"));
assert.equal((await action("costos", "saveProfitProduct", { ...costs, cost_currency: "HNL", fx_hnl_per_usd: "" })).ok, true);
assert.equal((await page("analista", "/api/export/profit")).res.status, 200);
console.log("PASS: HNL automatic rate overrides forged/missing form rates, conversion display and export");
const mixed = await action("costos", "saveProfitProduct", { ...costs,
  cost_currency: "USD", unit_cost: "4", import_cost: "1", import_currency: "USD", pickup_cost: "4", pickup_currency: "GTQ",
  fx_gtq_per_usd: "9999", fx_hnl_per_usd: "9999", [`m_${HN}_transfer`]: "26.3852", [`m_${HN}_transfer_currency`]: "HNL" });
assert.equal(mixed.ok, true, mixed.msg);
const mixedPage = (await page("costos", "/profit/costs")).text;
assert.ok(mixedPage.includes('"pickup_currency":"GTQ"'));
assert.ok(mixedPage.includes('"transfer_currency":"HNL"'));
assert.ok(mixedPage.includes("$7.72"));
assert.equal((await action("costos", "saveProfitProduct", { ...costs, import_currency: "INVALID" })).ok, false);
console.log("PASS: purchase USD + pickup GTQ + transfer HNL round-trip with server-controlled quotes");
const separated = { ...costs, unit_cost: "4", import_cost: "1", pickup_cost: "0.25", pickup_currency: "USD",
  [`m_${HN}_transfer`]: "19", [`m_${HN}_transfer_currency`]: "HNL", [`m_${HN}_collection`]: "3.50", [`m_${HN}_collection_currency`]: "HNL" };
assert.equal((await action("costos", "saveProfitProduct", separated)).ok, true);
const collectionPage = (await page("costos", "/profit/costs")).text;
assert.ok(collectionPage.includes('"collection_cost":3.5'));
assert.ok(collectionPage.includes('"collection_currency":"HNL"'));
assert.ok(collectionPage.includes("Recolecta"));
const { [`m_${HN}_collection`]: omittedAmount, [`m_${HN}_collection_currency`]: omittedCurrency, ...legacyForm } = separated;
assert.equal((await action("costos", "saveProfitProduct", legacyForm)).ok, true);
assert.ok((await page("costos", "/profit/costs")).text.includes('"collection_cost":3.5'));
assert.equal((await action("precios", "saveProductPrices", { id, [`m_${HN}_pu`]: "319", [`m_${HN}_collection`]: "999" })).ok, true);
assert.ok((await page("costos", "/profit/costs")).text.includes('"collection_cost":3.5'));
assert.ok(!(await page("precios", "/profit/prices")).text.includes('"collection_cost"'));
assert.equal((await action("costos", "saveProfitProduct", { ...separated, [`m_${HN}_collection`]: "-3.50" })).ok, false);
assert.equal((await action("costos", "saveProfitProduct", { ...separated, [`m_${HN}_collection_currency`]: "INVALID" })).ok, false);
const collectionExport = await (await fetch(base + "/api/export/profit", { headers: { Cookie: cookies.analista } })).arrayBuffer();
const { inflateRawSync } = await import("node:zlib");
const zip = Buffer.from(collectionExport);
let o = 0, xml = "";
while (o + 30 < zip.length && zip.readUInt32LE(o) === 0x04034b50) {
  const method = zip.readUInt16LE(o + 8), size = zip.readUInt32LE(o + 18), nameLen = zip.readUInt16LE(o + 26), extraLen = zip.readUInt16LE(o + 28);
  const name = zip.subarray(o + 30, o + 30 + nameLen).toString();
  const start = o + 30 + nameLen + extraLen, data = zip.subarray(start, start + size);
  if (name.endsWith(".xml")) xml += (method === 8 ? inflateRawSync(data) : data).toString();
  o = start + size;
}
assert.ok(xml.includes("Recolecta por cuenta"), "Excel must show the separate collection");
assert.equal((await action("costos", "saveProfitProduct", { ...separated, [`m_${HN}_collection`]: "" })).ok, true);
assert.ok(!(await page("costos", "/profit/costs")).text.includes('"collection_cost":3.5'));
console.log("PASS: separate collection round-trip, legacy preservation, price isolation, validation, Excel and explicit clearing");
await action("costos", "saveProfitProduct", { ...costs, unit_cost: "3.1" });
await action("precios", "saveProductPrices", { id, [`m_${HN}_pc`]: "300", [`m_${HN}_pu`]: "319", [`m_${GT}_pc`]: "95", [`m_${GT}_pu`]: "98.89" });
