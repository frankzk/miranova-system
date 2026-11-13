import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNotices, greetingName, noticeMessage, problemSince, webGroupUrl, type ProblemOrder, type StoreGroup } from "./problem-notices.ts";

const NOW = Date.parse("2026-11-14T15:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const HN = "acc-hn";
const SV = "acc-sv";

const order = (o: Partial<ProblemOrder>): ProblemOrder => ({
  id: "o1", account_id: HN, store_id: "s1", store_name: "Tienda Diego", country: "HN", external_id: "1793025184202",
  tracking_number: "FD44283594", since: ago(0.5), ...o,
});
const diego: StoreGroup = { contact_id: "c1", group_url: "https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrSt12", group_code: "AbCdEfGhIjKlMnOpQrSt12", owner_name: "diego gómez" };

test("cuándo entró a Problemas en gestión", () => {
  const tl = [
    { label: "Orden registrada", status: "registered", occurredAt: "2026-11-09T21:05:45Z" },
    { label: "Problemas en gestión", status: "6", occurredAt: "2026-11-10T02:00:00Z" },
    { label: "En ruta a destino", status: "3", occurredAt: "2026-11-11T13:51:26Z" },
    { label: "Problemas en gestión", status: "6", occurredAt: "2026-11-13T02:04:24Z" },
  ];
  assert.equal(problemSince(tl, "x"), "2026-11-13T02:04:24.000Z");
  // sin el código, por la etiqueta
  assert.equal(problemSince([{ label: "Problemas en gestión", occurredAt: "2026-11-12T00:00:00Z" }], "x"), "2026-11-12T00:00:00.000Z");
  assert.equal(problemSince(null, "2026-11-01T00:00:00Z"), "2026-11-01T00:00:00Z");
});

test("saludo y enlace del grupo", () => {
  assert.equal(greetingName("diego gómez"), "Diego");
  assert.equal(greetingName("  DARWIN  Lora"), "Darwin");
  assert.equal(greetingName("😀 Tienda"), null);
  assert.equal(greetingName(null), null);
  assert.equal(webGroupUrl("AbC123"), "https://web.whatsapp.com/accept?code=AbC123");
  assert.equal(webGroupUrl(null), null);
});

test("primer aviso: lo de los últimos 3 días, agrupado por grupo de WhatsApp", () => {
  const r = buildNotices({
    orders: [
      order({ id: "a", since: ago(1) }),
      order({ id: "b", external_id: "1793025178296", tracking_number: "FD44283576", since: ago(2) }),
      order({ id: "viejo", since: ago(10) }), // de antes: ya lo avisaba el equipo a mano
      order({ id: "otra", store_id: "s2", store_name: "Sin Grupo", since: ago(1) }),
    ],
    notified: new Map(), contacts: new Map([[`${HN}|s1`, diego]]), firstNotice: null, now: NOW,
  });
  assert.equal(r.groups.length, 1);
  const g = r.groups[0];
  assert.deepEqual(g.fresh.map((o) => o.id), ["b", "a"]);
  assert.equal(g.reminders.length, 0);
  assert.equal(g.web_url, "https://web.whatsapp.com/accept?code=AbCdEfGhIjKlMnOpQrSt12");
  assert.ok(g.message.startsWith("¡Hola, Diego! Buen día, ¿cómo estás? 😊\nTe compartimos tus pedidos que presentan *Problemas en gestión*"));
  assert.ok(g.message.includes("📦 Pedido: 1793025178296\n📄 Guía: FD44283576\n\n📦 Pedido: 1793025184202\n📄 Guía: FD44283594"));
  assert.ok(g.message.endsWith("¡Cualquier cosa, estamos aquí para apoyarte! 💙"));
  // la tienda sin grupo queda aparte
  assert.deepEqual(r.missing.map((m) => [m.title, m.fresh.length]), [["Sin Grupo", 1]]);
  assert.ok(r.missing[0].message.startsWith("¡Hola! Buen día"));
});

test("después: nuevos desde 3 días antes del primer aviso, recordatorios cada 3 días y nada pasados 30", () => {
  const notified = new Map([
    ["avisado-hoy", ago(0.2)],
    ["avisado-hace-3", ago(2.9)], // con la holgura de unas horas ya toca
    ["avisado-hace-2", ago(2)],
    ["volvio", ago(5)], // se avisó y volvió a entrar después
  ]);
  const r = buildNotices({
    orders: [
      order({ id: "avisado-hoy", since: ago(4) }),
      order({ id: "avisado-hace-3", since: ago(4) }),
      order({ id: "avisado-hace-2", since: ago(4) }),
      order({ id: "volvio", since: ago(1) }),
      order({ id: "nuevo-sin-avisar", since: ago(12) }), // entró después del inicio (hace 20 días − 3) y nunca se avisó
      order({ id: "antes-del-inicio", since: ago(25) }),
      order({ id: "muy-viejo", since: ago(31) }),
    ],
    notified, contacts: new Map([[`${HN}|s1`, diego]]), firstNotice: ago(20), now: NOW,
  });
  const g = r.groups[0];
  assert.deepEqual(g.fresh.map((o) => o.id).sort(), ["nuevo-sin-avisar", "volvio"]);
  assert.deepEqual(g.reminders.map((o) => o.id), ["avisado-hace-3"]);
  assert.ok(g.message.includes("⏰ Y estos siguen con *Problemas en gestión* desde el último aviso:"));
});

test("solo recordatorios y un dueño con tiendas en dos países: un mensaje con cada tienda", () => {
  const contacts = new Map([[`${HN}|s1`, diego], [`${SV}|s9`, diego]]);
  const r = buildNotices({
    orders: [order({ id: "a", since: ago(6) }), order({ id: "b", account_id: SV, store_id: "s9", store_name: "Diego SV", country: "SV", external_id: "555", tracking_number: null, since: ago(6) })],
    notified: new Map([["a", ago(4)], ["b", ago(4)]]), contacts, firstNotice: ago(10), now: NOW,
  });
  assert.equal(r.groups.length, 1);
  const msg = r.groups[0].message;
  assert.equal(r.groups[0].title, "Tienda Diego · Diego SV");
  assert.ok(msg.includes("Te recordamos estos pedidos que siguen con *Problemas en gestión*"));
  assert.ok(msg.includes("*Tienda Diego* (Honduras)\n📦 Pedido: 1793025184202"));
  assert.ok(msg.includes("*Diego SV* (El Salvador)\n📦 Pedido: 555\n📄 Guía: sin guía"));
});

test("nada que avisar", () => {
  const r = buildNotices({ orders: [order({ since: ago(1) })], notified: new Map([["o1", ago(0.1)]]), contacts: new Map(), firstNotice: ago(1), now: NOW });
  assert.deepEqual(r, { groups: [], missing: [] });
  assert.equal(noticeMessage({ owner_name: null, stores: [], fresh: [], reminders: [] }).split("\n")[0], "¡Hola! Buen día, ¿cómo estás? 😊");
});

test("reloj de Drop adelantado: no se repite el aviso recién enviado", () => {
  const future = new Date(NOW + 10 * 60_000).toISOString();
  const base = { contacts: new Map([[`${HN}|s1`, diego]]), firstNotice: ago(5), now: NOW };
  // sin avisar: entra igual (como si fuera ahora)
  assert.equal(buildNotices({ ...base, orders: [order({ id: "f", since: future })], notified: new Map() }).groups[0].fresh.length, 1);
  // avisado hace un minuto: no sale otra vez
  assert.deepEqual(buildNotices({ ...base, orders: [order({ id: "f", since: future })], notified: new Map([["f", ago(1 / 1440)]]) }), { groups: [], missing: [] });
  // volvió a entrar 2 horas después del aviso: sí
  assert.equal(buildNotices({ ...base, orders: [order({ id: "r", since: ago(1) })], notified: new Map([["r", ago(1 + 3 / 24)]]) }).groups[0].fresh.length, 1);
});
