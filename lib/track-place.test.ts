import assert from "node:assert/strict";
import { test } from "node:test";
import { originCountries, parsePlace, trackPlace } from "./track-place.ts";

const imp = { dest_country: "GT", origin: "China" };

test("lugar de DHL: ciudad y país", () => {
  assert.deepEqual(parsePlace("SHENZHEN - CHINA MAINLAND"), { country: "CN", city: "Shenzhen" });
  assert.deepEqual(parsePlace("CINCINNATI HUB - USA"), { country: "US", city: "Cincinnati" });
  assert.deepEqual(parsePlace("HONG KONG - HONG KONG"), { country: "HK", city: "Hong Kong" });
  assert.deepEqual(parsePlace("GUATEMALA CITY - GUATEMALA"), { country: "GT", city: "Guatemala City" });
  assert.deepEqual(parsePlace("LEIPZIG - GERMANY, DE"), { country: "DE", city: "Leipzig" });
  assert.deepEqual(parsePlace("Miami, FL, US"), { country: "US", city: "Miami" });
  assert.deepEqual(parsePlace(null), { country: null, city: null });
  assert.deepEqual(parsePlace("ALGUN LUGAR RARO"), { country: null, city: "Algun Lugar Raro" });
});

test("origen: China cuenta también Hong Kong", () => {
  assert.deepEqual(originCountries("China, Yiwu"), ["CN", "HK"]);
  assert.deepEqual(originCountries("Estados Unidos, Miami"), ["US"]);
  assert.deepEqual(originCountries(null), []);
});

test("dónde va: origen, tránsito, destino, entregado", () => {
  assert.deepEqual(trackPlace({ status: "InfoReceived", location: "SHENZHEN - CHINA MAINLAND" }, imp), { phase: "origin", label: "En China (origen)", country: "CN", city: "Shenzhen" });
  assert.equal(trackPlace({ status: "InTransit", location: "HONG KONG - HONG KONG" }, imp)!.label, "En Hong Kong (origen)");
  assert.equal(trackPlace({ status: "InTransit", location: "CINCINNATI HUB - USA" }, imp)!.label, "En tránsito · Estados Unidos");
  assert.deepEqual(trackPlace({ status: "InTransit", location: "GUATEMALA CITY - GUATEMALA" }, imp), { phase: "destination", label: "En Guatemala (destino)", country: "GT", city: "Guatemala City" });
  assert.equal(trackPlace({ status: "OutForDelivery", location: "GUATEMALA CITY - GUATEMALA" }, imp)!.phase, "destination");
  assert.equal(trackPlace({ status: "Delivered", location: "GUATEMALA CITY - GUATEMALA" }, imp)!.label, "Entregado");
  assert.equal(trackPlace({ status: "InfoReceived", location: null }, imp)!.label, "Por recoger en origen");
  assert.equal(trackPlace({ status: "InTransit", location: null }, imp)!.label, "En tránsito");
  assert.equal(trackPlace({ status: null, location: null }, imp), null);
});
