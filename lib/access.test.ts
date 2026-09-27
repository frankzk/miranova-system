import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, makeSessionToken, readSessionToken, verifyPassword } from "./passwords.ts";
import { can, effectivePermissions, normalizePermissions, passwordProblem, permissionFlags, ungrantable, USERNAME_RE } from "./permissions.ts";

const UID = "11111111-2222-4333-8444-555555555555";
const SECRET = "test-secret";

test("contraseña: el hash verifica la correcta y rechaza otra; cada hash lleva sal propia", async () => {
  const h = await hashPassword("clave-segura-1");
  assert.match(h, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await verifyPassword("clave-segura-1", h), true);
  assert.equal(await verifyPassword("clave-segura-2", h), false);
  assert.notEqual(await hashPassword("clave-segura-1"), h);
  assert.equal(await verifyPassword("x", "texto-plano"), false);
});

test("sesión: firma válida, vencida, alterada o con otro secreto", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  const { value } = makeSessionToken(UID, 3, SECRET, now);
  assert.deepEqual(readSessionToken(value, SECRET, now), { userId: UID, version: 3 });
  assert.equal(readSessionToken(value, "otro", now), null);
  assert.equal(readSessionToken(value, SECRET, now + 31 * 86400_000), null);
  const [u, , e, sig] = value.split(".");
  assert.equal(readSessionToken(`${u}.4.${e}.${sig}`, SECRET, now), null);
  assert.equal(readSessionToken("basura", SECRET, now), null);
  assert.equal(readSessionToken(undefined, SECRET, now), null);
});

test("permisos: el dueño puede todo; los demás solo lo marcado", () => {
  const owner = { is_owner: true, permissions: [] };
  const ops = { is_owner: false, permissions: ["orders", "stores"] };
  assert.equal(can(owner, "money"), true);
  assert.equal(can(ops, "orders"), true);
  assert.equal(can(ops, "money"), false);
  assert.equal(can(null, "orders"), false);
  assert.deepEqual(effectivePermissions(ops), ["orders", "stores"]);
  assert.equal(permissionFlags(ops).users, false);
});

test("permisos del formulario: claves desconocidas fuera, editar tiendas incluye verlas", () => {
  assert.deepEqual(normalizePermissions(["money", "admin", "stores_edit", "money"]), ["stores", "stores_edit", "money"]);
});

test("solo se otorgan permisos que uno mismo tiene", () => {
  const admin = { is_owner: false, permissions: ["users", "orders"] };
  assert.deepEqual(ungrantable(admin, ["orders", "money", "accounts"]), ["money", "accounts"]);
  assert.deepEqual(ungrantable({ is_owner: true, permissions: [] }, ["money"]), []);
});

test("usuario y contraseña: reglas mínimas", () => {
  assert.equal(USERNAME_RE.test("andrea.m"), true);
  assert.equal(USERNAME_RE.test("An"), false);
  assert.equal(USERNAME_RE.test("con espacio"), false);
  assert.equal(USERNAME_RE.test("frank@ejemplo.com"), true);
  assert.match(passwordProblem("corta") ?? "", /al menos 8/);
  assert.match(passwordProblem("andrea2026", "andrea") ?? "", /usuario/);
  assert.equal(passwordProblem("aaaaaaaaaa"), "La contraseña no puede ser un mismo carácter repetido.");
  assert.equal(passwordProblem("Verde-Mango-42", "andrea"), null);
});

test("volver después de entrar: solo rutas internas del panel", async () => {
  const { safeNext } = await import("./permissions.ts");
  assert.equal(safeNext("/orders?group=problem"), "/orders?group=problem");
  assert.equal(safeNext("//evil.example"), "/");
  assert.equal(safeNext("/\\evil.example"), "/");
  assert.equal(safeNext("https://evil.example"), "/");
  assert.equal(safeNext("/api/logout"), "/");
  assert.equal(safeNext("/login?next=/x"), "/");
  assert.equal(safeNext(null), "/");
});
