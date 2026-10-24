import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canMergeContacts, contactFill, formatPhone, mergeSurvivor, nameTokens, normalizeEmail, normalizePhone, parseWhatsappGroup, storeEmail, suggestLinks,
  type ContactData, type DirectoryStore,
} from "./store-contacts.ts";

const CODE = "AbCdEfGhIjKlMnOpQrStUv";

test("enlace de grupo: acepta variantes y deja el enlace limpio", () => {
  const want = { url: `https://chat.whatsapp.com/${CODE}`, code: CODE };
  assert.deepEqual(parseWhatsappGroup(`https://chat.whatsapp.com/${CODE}`), want);
  assert.deepEqual(parseWhatsappGroup(` chat.whatsapp.com/${CODE}?mode=ems_copy_t `), want);
  assert.deepEqual(parseWhatsappGroup(`https://chat.whatsapp.com/invite/${CODE}`), want);
});

test("enlace de grupo: rechaza lo que no es una invitación", () => {
  assert.equal(parseWhatsappGroup(""), null);
  assert.equal(parseWhatsappGroup("https://wa.me/50499998888"), null);
  assert.equal(parseWhatsappGroup(`https://chat.whatsapp.com.evil.com/${CODE}`), null);
  assert.equal(parseWhatsappGroup("https://chat.whatsapp.com/corto"), null);
  assert.equal(parseWhatsappGroup(`https://chat.whatsapp.com/${CODE}/extra`), null);
});

test("teléfono: un número local toma el código del país de la cuenta", () => {
  assert.equal(normalizePhone("9999-8888", "HN"), "50499998888");
  assert.equal(normalizePhone("5555 1234", "GT"), "50255551234");
  assert.equal(normalizePhone("+504 9999 8888", "GT"), "50499998888");
  assert.equal(normalizePhone("00506 8888 7777", "HN"), "50688887777");
  assert.equal(normalizePhone("12345", "HN"), null);
  assert.equal(formatPhone("50499998888"), "+504 9999 8888");
});

test("palabras que identifican una tienda (sin país ni palabras genéricas)", () => {
  assert.deepEqual(nameTokens("Velora Store Salvador"), ["velora"]);
  assert.deepEqual(nameTokens("Vital Market"), ["vital"]);
  assert.deepEqual(nameTokens("Vitaluxe HN"), ["vitaluxe"]);
});

const st = (account_id: string, store_id: string, country: string, name: string, person: string | null): DirectoryStore => ({
  account_id, store_id, account_name: `Drop ${country}`, country, name, person, last_at: "2026-09-20T00:00:00Z", orders90: 10,
});

test("sugerencias: mismo responsable primero; nombre parecido con otro responsable al final y marcado", () => {
  const self = st("hn", "1", "HN", "Velora Honduras", "Santiago Maramer");
  const all = [
    self,
    st("sv", "2", "SV", "Velora Store Salvador", "santiago  maramer"),
    st("gt", "3", "GT", "VELORA", "Sharon González"),
    st("gt", "4", "GT", "Otra Tienda", "Alguien Más"),
  ];
  const s = suggestLinks(self, all, []);
  assert.deepEqual(s.map((x) => [x.store.store_id, x.reason, x.other_person]), [
    ["2", "same_person", false],
    ["3", "similar_name", true],
  ]);
});

test("sugerencias: se omiten las que ya están en el mismo contacto y se informa el contacto ajeno", () => {
  const self = st("hn", "1", "HN", "Vitaluxe HN", "Jazmin Mancilla");
  const all = [self, st("cr", "2", "CR", "Vitaluxe", "Jazmin Mancilla"), st("sv", "3", "SV", "Vitaluxe SV", null)];
  const links = [
    { account_id: "hn", store_id: "1", contact_id: "c1", store_name: null },
    { account_id: "cr", store_id: "2", contact_id: "c1", store_name: null },
    { account_id: "sv", store_id: "3", contact_id: "c9", store_name: null },
  ];
  const s = suggestLinks(self, all, links);
  assert.equal(s.length, 1);
  assert.equal(s[0].store.store_id, "3");
  assert.equal(s[0].contact_id, "c9");
  assert.equal(s[0].other_person, false);
});

test("correo de la tienda: el del contacto manda sobre el detectado en los pedidos", () => {
  assert.equal(normalizeEmail("  Info@ClickSiHonduras.com "), "info@clicksihonduras.com");
  assert.equal(normalizeEmail("sin correo"), null);
  assert.equal(normalizeEmail("a@b"), null);
  assert.deepEqual(storeEmail("tienda@x.com", "otra@y.com"), { email: "tienda@x.com", source: "contacto" });
  assert.deepEqual(storeEmail(null, "otra@y.com"), { email: "otra@y.com", source: "pedidos" });
  assert.deepEqual(storeEmail("  ", undefined), null);
});

test("unir contactos: queda el que tiene grupo y se completa lo que le falta sin pisar nada", () => {
  const hn: ContactData = { whatsapp_group_url: "https://chat.whatsapp.com/ABC", whatsapp_group_code: "ABC", owner_name: "Miguel Jaramillo", owner_phone: null, email: null, notes: null };
  const sv: ContactData = { whatsapp_group_url: null, whatsapp_group_code: null, owner_name: "Divertix Shop", owner_phone: "573166921804", email: "zuper@gmail.com", notes: "Responde de noche" };
  assert.equal(mergeSurvivor(sv, hn).into, hn);
  assert.equal(mergeSurvivor(hn, sv).into, hn);
  // el nombre distinto queda anotado en las notas para no perderlo
  assert.deepEqual(contactFill(hn, [sv]), { owner_phone: "573166921804", email: "zuper@gmail.com", notes: "Responde de noche\nTambién: Divertix Shop" });
  // dos teléfonos distintos: queda el de `into` y el otro, anotado
  assert.deepEqual(contactFill({ ...hn, owner_phone: "50499990000", owner_name: null }, [{ owner_phone: "50255551234" }]), { notes: "Otro teléfono: +502 5555 1234" });
  // lo escrito en el formulario va primero; las notas distintas se suman, las iguales no
  assert.deepEqual(contactFill({ ...hn, notes: "Prefiere audios" }, [{ notes: "prefiere  audios" }, { notes: "Solo de 8 a 5" }]), { notes: "Prefiere audios\nSolo de 8 a 5" });
  assert.deepEqual(contactFill(hn, [{ whatsapp_group_url: "https://chat.whatsapp.com/XYZ", whatsapp_group_code: "XYZ" }]), {});
  // dos grupos distintos no se unen (sería perder uno)
  assert.equal(canMergeContacts(hn, { ...sv, whatsapp_group_code: "XYZ" }), false);
  assert.equal(canMergeContacts(hn, sv), true);
});
