import assert from "node:assert/strict";
import { test } from "node:test";
import { accessEmail } from "./access-email.ts";

test("correo de acceso: usuario, contraseña temporal y enlace; texto escapado", () => {
  const m = accessEmail({ kind: "reset", name: "Gaby <Ríos>", username: "gaby@aurela.pe", password: "Temp-1234&x", loginUrl: "https://miranova-system.vercel.app/login" });
  assert.equal(m.subject, "Tu nueva contraseña temporal de Miranova");
  assert.ok(m.html.includes("Hola Gaby:"));
  assert.ok(m.html.includes("Temp-1234&amp;x"));
  assert.ok(!m.html.includes("<Ríos>"));
  assert.ok(m.html.includes('href="https://miranova-system.vercel.app/login"'));
  assert.match(m.text, /Usuario: gaby@aurela\.pe\nContraseña temporal: Temp-1234&x/);
  assert.equal(accessEmail({ kind: "new", name: "Andrea", username: "a@b.co", password: "x", loginUrl: "u" }).subject, "Tu acceso al panel de Miranova");
});
