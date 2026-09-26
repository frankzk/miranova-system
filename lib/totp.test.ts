import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTotpSecret, totp } from "./totp.ts";

// Vectores de la RFC 6238 (SHA-1, clave "12345678901234567890").
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("totp coincide con la RFC 6238", () => {
  assert.equal(totp(SECRET, 59_000), "287082");
  assert.equal(totp(SECRET, 1_111_111_109_000), "081804");
  assert.equal(totp(SECRET, 1_234_567_890_000), "005924");
});

test("acepta la clave con espacios, minúsculas o como enlace otpauth", () => {
  assert.equal(parseTotpSecret("gezd gnbv gy3t qojq gezd gnbv gy3t qojq"), SECRET);
  assert.equal(parseTotpSecret(`otpauth://totp/Dropi:yo@x.com?secret=${SECRET}&issuer=Dropi`), SECRET);
  assert.equal(parseTotpSecret("123456"), null); // un código suelto no sirve: caduca
  assert.equal(parseTotpSecret("no-es-base32!!"), null);
});
