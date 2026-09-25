import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

test("conector soydrop contra API simulada", async () => {
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const j = (s: number, o: unknown, h: Record<string, string> = {}) => { res.writeHead(s, { "content-type": "application/json", ...h }); res.end(JSON.stringify(o)); };
      if (req.url === "/auth/login") {
        const b = JSON.parse(body);
        if (b.password !== "ok") return j(401, { message: "Credenciales inválidas" });
        return j(200, { ok: true, data: { identityToken: "ID1", accounts: [{ ref: "HN1", name: "Miranova HN" }, { ref: "GT1", name: "Miranova GT" }] } });
      }
      if (req.url === "/auth/accounts/select") {
        assert.equal(JSON.parse(body).ref, "GT1");
        return j(200, { data: { accessToken: "ACC", refreshToken: "R" } }, { "set-cookie": "sid=abc; Path=/; HttpOnly" });
      }
      if (req.headers.authorization !== "Bearer ACC") return j(401, { message: "no auth" });
      if (req.url?.startsWith("/products/?")) return j(200, { data: [{ id: "p1", name: "MINI FAN", sku: "MINI.FAN", price: 292.11, totalStock: 448 }], total: 1 });
      if (req.url?.startsWith("/vendor/orders")) return j(404, { message: "not found" });
      if (req.url?.startsWith("/vendors/orders")) return j(200, { data: { items: [{ id: 7, orderNumber: "99", status: "Pendiente", total: 10, customer: { name: "A" } }], total: 1 } });
      j(404, {});
    });
  });
  await new Promise<void>((r) => srv.listen(0, r));
  process.env.SOYDROP_API_URL = `http://127.0.0.1:${(srv.address() as any).port}`;
  const { soydrop } = await import("./soydrop.ts");

  await assert.rejects(soydrop.login("a@b.c", "mal"), /incorrectos/);
  const login = await soydrop.login("a@b.c", "ok");
  assert.equal(login.identity, "ID1");
  assert.deepEqual(login.accounts.map((a: any) => a.ref), ["HN1", "GT1"]);
  const s = await soydrop.selectAccount(login, "GT1");
  assert.equal(s.token, "ACC");
  assert.equal(s.cookie, "sid=abc");
  const d = await soydrop.discoverOrdersPath(s);
  assert.equal(d.path, "/vendors/orders");
  assert.equal(d.attempts[0].status, 404);
  const p = await soydrop.fetchOrders(s, d.path!, 1);
  assert.match(p.url, /page=1&limit=100/);
  const r = await soydrop.fetchOrders(s, d.path!, 2, { from: new Date("2026-08-01T00:00:00Z"), to: new Date("2026-09-01T00:00:00Z") });
  assert.match(r.url, /page=2&limit=100&dateFrom=2026-08-01T00%3A00%3A00.000Z&dateTo=2026-09-01/);
  await assert.rejects(soydrop.fetchOrders({ token: "viejo", obtainedAt: 0 }, "/vendors/orders", 1), /caduc/);
  const pp = await soydrop.discoverProductsPath!(s);
  assert.equal(pp.path, "/products/");
  const prods = await soydrop.fetchProducts!(s, pp.path!, 1);
  assert.match(prods.url, /\/products\/\?page=1&limit=100/);
  srv.close();
});
