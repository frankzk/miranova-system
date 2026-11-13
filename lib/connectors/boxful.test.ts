import assert from "node:assert/strict";
import { test } from "node:test";
import { clientIdOf, jwtClaims } from "./boxful.ts";

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
