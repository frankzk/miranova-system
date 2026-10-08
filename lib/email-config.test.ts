import assert from "node:assert/strict";
import { test } from "node:test";
import { appPassword, emailProvider, explainSendError, senderOf } from "./email-config.ts";

test("proveedor: Gmail si están usuario y contraseña de aplicación; si no, Resend; si no, ninguno", () => {
  assert.equal(emailProvider({ GMAIL_USER: "a@gmail.com", GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop", RESEND_API_KEY: "re_x" }), "gmail");
  assert.equal(emailProvider({ GMAIL_USER: "a@gmail.com", RESEND_API_KEY: "re_x" }), "resend");
  assert.equal(emailProvider({ GMAIL_USER: " ", GMAIL_APP_PASSWORD: "x" }), null);
  assert.equal(emailProvider({}), null);
});

test("contraseña de aplicación sin espacios y remitente", () => {
  assert.equal(appPassword(" abcd efgh\tijkl mnop "), "abcdefghijklmnop");
  assert.equal(senderOf({}, "miranova@gmail.com"), "Miranova Inventario <miranova@gmail.com>");
  assert.equal(senderOf({ EMAIL_FROM: "Miranova <inventario@aurela.pe>" }, "x@y.z"), "Miranova <inventario@aurela.pe>");
});

test("errores en español y con qué hacer", () => {
  assert.match(explainSendError("gmail", "Invalid login: 535-5.7.8 Username and Password not accepted", "EAUTH"), /contraseña de aplicación/);
  const resend = explainSendError("resend", "You can only send testing emails to your own email address (frvnkzzz@gmail.com). To send emails to other recipients, please verify a domain");
  assert.match(resend, /modo de prueba: solo deja enviar a frvnkzzz@gmail\.com/);
  assert.equal(explainSendError("resend", "rate limited"), "Resend: rate limited");
});
