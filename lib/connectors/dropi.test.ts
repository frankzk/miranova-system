import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { totp } from "../totp.ts";
import { extractOrders } from "../normalize.ts";

const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
// JWT de prueba con sub = 42366 (firma irrelevante)
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const TOKEN = `${b64({ typ: "JWT", alg: "HS256" })}.${b64({ sub: "42366", aud: "DROPI" })}.firma`;

const ORDER = {
  id: 1483229, status: "GUIA_GENERADA", created_at: "2026-09-25 15:51:00",
  name: "Ana", surname: "López", phone: "55551234", dir: "Zona 1", city: "Mixco", state: "Guatemala",
  total_order: "250.00", shipping_amount: "30", shipping_company: "Forza", shipping_guide: "G123",
  rate_type: "CON RECAUDO", user: { name: "Tienda", surname: "X" },
  orderdetails: [{ quantity: 2, price: 125, supplier_price: 60, product: { name: "Drenaje Linfático Gotas", sku: "DLG" } }],
};

test("conector dropi: login con 2FA y órdenes", async () => {
  const seen: { otp?: unknown; query?: URLSearchParams } = {};
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const j = (s: number, o: unknown) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      const url = new URL(req.url!, "http://x");
      if (url.pathname === "/bff/auth/core/login") {
        const b = JSON.parse(body);
        seen.otp = b.otp;
        if (b.password !== "ok") return j(401, { isSuccess: false, message: "Credenciales incorrectas" });
        if (b.otp !== totp(SECRET)) return j(200, { isSuccess: false, message: "Se requiere el código OTP" });
        return j(200, { isSuccess: true, token: TOKEN, objects: { name: "Frankz" } });
      }
      if (req.headers["x-authorization"] !== `Bearer ${TOKEN}`) return j(401, { message: "Unauthenticated" });
      if (url.pathname === "/api/orders/myorders/v2") {
        seen.query = url.searchParams;
        return j(200, { isSuccess: true, objects: url.searchParams.get("start") === "0" ? [ORDER] : [], count: 1 });
      }
      j(404, {});
    });
  });
  await new Promise<void>((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${(srv.address() as any).port}`;
  process.env.DROPI_AUTH_URL = base;
  process.env.DROPI_API_URL = base;
  const { dropi } = await import("./dropi.ts");
  const c = dropi("GT", "America/Guatemala");

  try {
    await assert.rejects(c.login("a@b.c", "ok"), /verificación en dos pasos/);
    await assert.rejects(c.login("a@b.c", "mal", { totpSecret: SECRET }), /incorrectos/);

    const login = await c.login("a@b.c", "ok", { totpSecret: SECRET });
    assert.equal(seen.otp, totp(SECRET));
    assert.deepEqual(login.accounts, [{ ref: "42366", name: "Frankz" }]);

    const session = await c.selectAccount(login, "42366");
    const probe = await c.discoverOrdersPath(session);
    assert.equal(probe.path, "/api/orders/myorders/v2");

    const page = await c.fetchOrders(session, probe.path!, 1, { from: new Date("2026-08-26T12:00:00Z"), to: new Date("2026-09-25T12:00:00Z") });
    assert.equal(page.rows, 1);
    assert.equal(seen.query?.get("supplier_id"), "42366");
    assert.equal(seen.query?.get("from"), "2026-08-26");
    assert.equal(seen.query?.get("until"), "2026-09-25");

    await assert.rejects(c.fetchOrders({ token: "viejo", obtainedAt: 0 }, probe.path!, 1), (e: Error) => e.name === "Error" && /caducó/.test(e.message));
  } finally {
    srv.close();
  }
});

test("mapeo de órdenes de Dropi", () => {
  const [o] = extractOrders({ isSuccess: true, objects: [ORDER] }, { currency: "GTQ", timezone: "America/Guatemala" });
  assert.equal(o.external_id, "1483229");
  assert.equal(o.status, "Guía generada");
  assert.equal(o.status_code, "pending");
  assert.equal(o.customer_name, "Ana López");
  assert.equal(o.dropshipper, "Tienda X");
  assert.equal(o.city, "Mixco");
  assert.equal(o.department, "Guatemala");
  assert.equal(o.tracking_number, "G123");
  assert.equal(o.total, 250);
  assert.equal(o.vendor_amount, 120);
  assert.equal(o.cod, true);
  assert.equal(o.currency, "GTQ");
  assert.equal(o.ordered_at, "2026-09-25T21:51:00.000Z"); // 15:51 en Guatemala (UTC-6)
  assert.deepEqual(o.items.map((i) => [i.product_name, i.quantity, i.sku]), [["Drenaje Linfático Gotas", 2, "DLG"]]);
});
