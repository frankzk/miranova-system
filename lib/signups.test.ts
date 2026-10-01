import assert from "node:assert/strict";
import { test } from "node:test";
import { filterSignups, localDay, monthBounds, signupPeriod, toSignups, type Signup } from "./signups.ts";

const s = (p: Partial<Signup>): Signup => ({
  account_id: "hn", store_id: "1", account_name: "Drop Honduras", name: "Tienda", person: null, first_at: "2026-09-10T15:00:00Z", email: null, ...p,
});

test("meses: este y el anterior, con años y largos distintos", () => {
  assert.deepEqual(monthBounds("2026-09-30"), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(monthBounds("2026-03-15", -1), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(monthBounds("2026-01-05", -1), { from: "2025-12-01", to: "2025-12-31" });
});

test("tiendas nuevas: ingreso por día local de la cuenta, búsqueda y orden", () => {
  const tz = () => "America/Tegucigalpa";
  // 1 oct 03:00 UTC es 30 sep 21:00 en Honduras: cuenta como septiembre
  assert.equal(localDay("2026-10-01T03:00:00Z", "America/Tegucigalpa"), "2026-09-30");
  const a = s({ store_id: "a", name: "ClickSi HN", person: "Juan Pérez", first_at: "2026-10-01T03:00:00Z", email: "info@clicksihonduras.com" });
  const b = s({ store_id: "b", name: "Vital Market", person: "Ana López", first_at: "2026-08-20T15:00:00Z" });
  const c = s({ store_id: "c", name: "Nutralix", person: "Mario", first_at: "2026-09-15T15:00:00Z" });
  assert.deepEqual(filterSignups([b, c, a], {}, tz), [a, c, b]);
  assert.deepEqual(filterSignups([b, c, a], { from: "2026-09-01", to: "2026-09-30" }, tz), [a, c]);
  assert.deepEqual(filterSignups([b, c, a], { q: "perez" }, tz), [a]);
  assert.deepEqual(filterSignups([b, c, a], { q: "clicksihonduras" }, tz), [a]);
  assert.deepEqual(filterSignups([b, c, a], { q: "ana vital" }, tz), [b]);
});

test("tiendas nuevas: el correo del contacto gana al detectado y el dueño de Drop al del contacto", () => {
  const rows = [
    s({ store_id: "a", person: "Juan Pérez", email: "info@clicksihonduras.com" }),
    s({ store_id: "b", person: null, email: null }),
    s({ store_id: "c", person: "Ana López", email: null }),
  ];
  const contacts: Record<string, { email?: string | null; owner_name?: string | null }> = {
    a: { email: "ventas@clicksi.hn", owner_name: "juan perez" },
    b: { owner_name: "Carla Ruiz" },
    c: { email: null, owner_name: "Rosa Díaz" },
  };
  const [a, b, c] = toSignups(rows, (r) => contacts[r.store_id]);
  assert.deepEqual([a.email, a.emailSource, a.person, a.contactOwner], ["ventas@clicksi.hn", "contacto", "Juan Pérez", null]);
  assert.deepEqual([b.email, b.emailSource, b.person, b.contactOwner], [null, null, "Carla Ruiz", null]);
  assert.deepEqual([c.email, c.emailSource, c.person, c.contactOwner], [null, null, "Ana López", "Rosa Díaz"]);
  const [d] = toSignups([rows[0]], () => undefined);
  assert.deepEqual([d.email, d.emailSource], ["info@clicksihonduras.com", "pedidos"]);
});

test("período de tiendas nuevas desde la URL", () => {
  const today = "2026-10-01";
  assert.deepEqual(signupPeriod({}, today), { period: "todas", custom: null, bounds: null });
  assert.deepEqual(signupPeriod({ p: "anterior" }, today).bounds, { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(signupPeriod({ p: "mes" }, today).bounds, { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(signupPeriod({ p: "otro" }, today).period, "todas");
  // el rango propio gana, se ordena y no pasa de hoy
  assert.deepEqual(signupPeriod({ p: "mes", from: "2026-12-01", to: "2026-09-15" }, today), {
    period: "rango", custom: { from: "2026-09-15", to: "2026-10-01" }, bounds: { from: "2026-09-15", to: "2026-10-01" },
  });
  assert.equal(signupPeriod({ from: "no" }, today).period, "todas");
});
