import assert from "node:assert/strict";
import { test } from "node:test";
import { clientIdOf, jwtClaims, settlementCandidates } from "./boxful.ts";

const jwt = (payload: object) => `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;

test("id del cliente: en la respuesta del login o en el token", () => {
  assert.equal(clientIdOf({ data: { clientId: "c-1" } }, undefined), "c-1");
  assert.equal(clientIdOf({ client: { id: 77 } }, undefined), "77");
  assert.equal(clientIdOf(null, jwt({ clientId: "c-2", email: "a@b.c" })), "c-2");
  assert.equal(clientIdOf(null, jwt({ client: { id: "c-3" } })), "c-3");
  assert.equal(clientIdOf(null, jwt({ sub: "u-9" })), "u-9");
  assert.equal(clientIdOf(null, "no-es-jwt"), undefined);
  assert.deepEqual(jwtClaims(undefined), {});
});

test("rutas candidatas de liquidaciones", () => {
  const sin = settlementCandidates(undefined, "2026-07-16", "2026-11-13");
  assert.ok(sin.includes("/settlements"));
  assert.ok(sin.some((p) => p.includes("startDate=2026-07-16&endDate=2026-11-13")));
  const con = settlementCandidates("c/1", "a", "b");
  assert.ok(con.includes("/client/c%2F1/settlements"));
  assert.ok(con.length > sin.length);
});
