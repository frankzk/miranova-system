import assert from "node:assert/strict";
import { test } from "node:test";
import type { InventoryRow, RestockOrder, Supply } from "./inventory.ts";
import { parseRecipients, restockDigest } from "./restock-digest.ts";

const TODAY = "2026-10-04";
const row = (p: Partial<InventoryRow>): InventoryRow => ({
  account_id: "a", account_name: "Drop Honduras", external_id: "p", code: null, name: "Producto", status: "Activo", image_url: null,
  stock: 0, variants_count: 0, out14: 140, ret14: 0, out30: 300, ret30: 0, last_out_at: null, first_at: null, last_restock_at: null,
  restocks: [], pending_orders: 0, daily: [...Array(29).fill(10), 3], ...p,
});
const order = (p: Partial<RestockOrder>): RestockOrder => ({
  id: "o", account_id: "a", product_external_id: "p", units: 200, ordered_at: "2026-09-20T12:00:00+00:00", eta: null,
  note: null, cancelled_at: null, ...p,
});
const supply = (orders: RestockOrder[] = []): Supply => ({ orders, leads: new Map() });

test("destinatarios: separa, limpia y descarta lo que no es correo", () => {
  assert.deepEqual(parseRecipients("gaby@aurela.pe"), ["gaby@aurela.pe"]);
  assert.deepEqual(parseRecipients(" Gaby@Aurela.pe; ops@miranova.com , no-es-correo,gaby@aurela.pe "), ["gaby@aurela.pe", "ops@miranova.com"]);
  assert.deepEqual(parseRecipients(undefined), []);
});

test("resumen: agotados, pedir hoy, esta semana y pedidos atrasados, con el botón al panel", () => {
  const rows = [
    row({ external_id: "a", name: "Gotas <Drenaje> & Co", stock: 0, pending_orders: 3 }),
    row({ external_id: "b", name: "Cayenne", stock: 90, account_name: "Drop El Salvador" }),
    row({ external_id: "c", name: "Pulsera", stock: 150 }),
    row({ external_id: "d", name: "Holgado", stock: 500 }),
    row({ external_id: "e", name: "Quieto", stock: 80, out14: 0, out30: 0, daily: [] }),
  ];
  const late = order({ product_external_id: "d", eta: "2026-10-01", note: "Proveedor X" });
  const d = restockDigest(rows, supply([late]), TODAY, "https://miranova-system.vercel.app/");
  assert.deepEqual(d.counts, { out: 1, now: 1, soon: 1, late: 1 });
  assert.equal(d.empty, false);
  assert.equal(d.subject, "Qué pedir hoy · 1 agotado, 1 para pedir hoy, 1 esta semana, 1 pedido atrasado");
  // los nombres van escapados (vienen de Drop)
  assert.ok(d.html.includes("Gotas &lt;Drenaje&gt; &amp; Co"));
  assert.ok(!d.html.includes("<Drenaje>"));
  assert.ok(d.html.includes('href="https://miranova-system.vercel.app/products/inventory"'));
  assert.match(d.text, /- Gotas <Drenaje> & Co \(Drop Honduras\): pedir ya 410 u\./);
  assert.match(d.text, /- Cayenne \(Drop El Salvador\): pedir hoy 320 u\./);
  assert.match(d.text, /- Pulsera \(Drop Honduras\): pedir antes del .+ 300 u\./);
  assert.match(d.text, /PEDIDOS ATRASADOS \(1\)\n- Holgado \(Drop Honduras\): 200 u\. sin llegar\. pedido el .+ · llegaba el .+ · Proveedor X/);
  assert.ok(!d.text.includes("Quieto"));
});

test("lo que ya viene no se vuelve a pedir; sin nada que pedir, el resumen queda vacío", () => {
  const coming = supply([order({ product_external_id: "b", units: 300, ordered_at: "2026-10-03T12:00:00+00:00", eta: "2026-10-09" })]);
  const d = restockDigest([row({ external_id: "b", stock: 90 })], coming, TODAY, "https://x.app");
  assert.equal(d.empty, true);
  assert.match(d.subject, /^Inventario al día · /);
});
