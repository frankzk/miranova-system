import { test } from "node:test";
import assert from "node:assert/strict";
import { newEvents, parseRegisterResponse, parseTrackResponse, trackAlert, trackStatusInfo } from "./tracking17.ts";

// forma de la respuesta de gettrackinfo (API v2.2)
const sample = {
  code: 0,
  data: {
    accepted: [
      {
        number: "1234567890",
        carrier: 100001,
        track_info: {
          latest_status: { status: "InTransit", sub_status: "InTransit_Other", sub_status_descr: null },
          latest_event: { time_iso: "2026-10-08T21:10:00+08:00", time_utc: "2026-10-08T13:10:00Z", description: "Departed Facility in HONG KONG", location: "HONG KONG, HK", stage: "Departure" },
          time_metrics: { days_after_order: 6, estimated_delivery_date: { source: "Official", from: "2026-10-12T00:00:00Z", to: "2026-10-13T00:00:00Z" } },
          tracking: {
            providers: [{
              provider: { key: 100001, name: "DHL" },
              events: [
                { time_iso: "2026-10-08T21:10:00+08:00", time_utc: "2026-10-08T13:10:00Z", description: "Departed Facility in HONG KONG", location: "HONG KONG, HK" },
                { time_iso: "2026-10-07T10:00:00+08:00", time_utc: "2026-10-07T02:00:00Z", description: "Processed at HONG KONG", location: null, address: { city: "Hong Kong", country: "HK" } },
                { time_iso: "2026-10-05T09:00:00+08:00", time_utc: "2026-10-05T01:00:00Z", description: "Shipment picked up", location: "SHENZHEN, CN" },
              ],
            }],
          },
        },
      },
    ],
    rejected: [{ number: "BAD123", error: { code: -18019909, message: "No tracking information at this time." } }],
  },
};

test("17TRACK: estado, última novedad, llegada estimada y novedades", () => {
  const r = parseTrackResponse(sample);
  assert.equal(r.accepted.length, 1);
  const t = r.accepted[0];
  assert.equal(t.status, "InTransit");
  assert.deepEqual(t.latest, { text: "Departed Facility in HONG KONG", location: "HONG KONG, HK", at: "2026-10-08T13:10:00.000Z" });
  assert.equal(t.eta, "2026-10-13");
  assert.deepEqual(t.events.map((e) => e.location), ["HONG KONG, HK", "Hong Kong, HK", "SHENZHEN, CN"]);
  assert.deepEqual(r.rejected, [{ number: "BAD123", message: "No tracking information at this time." }]);
  assert.equal(trackStatusInfo("Delivered").label, "Entregada");
  assert.equal(trackAlert("Exception"), true);
  assert.equal(trackAlert("InTransit"), false);
});

test("17TRACK: respuestas incompletas no rompen", () => {
  assert.deepEqual(parseTrackResponse(null), { accepted: [], rejected: [] });
  const r = parseTrackResponse({ data: { accepted: [{ number: "X1", track_info: { latest_status: { status: "NotFound" } } }, { foo: 1 }] } });
  assert.deepEqual(r.accepted, [{ number: "X1", status: "NotFound", subStatus: null, latest: null, eta: null, events: [] }]);
});

test("17TRACK: registrar (ya registrada también sirve) y solo las novedades nuevas", () => {
  const reg = parseRegisterResponse({
    code: 0,
    data: {
      accepted: [{ number: "A1", carrier: 100001 }],
      rejected: [
        { number: "A2", error: { code: -18019901, message: "The tracking number 'A2' has been registered, don't need to repeat registration." } },
        { number: "A3", error: { code: -18019903, message: "Carrier cannot be detected." } },
      ],
    },
  });
  assert.deepEqual(reg, { ok: ["A1", "A2"], failed: [{ number: "A3", message: "Carrier cannot be detected." }] });
  const t = parseTrackResponse(sample).accepted[0];
  assert.deepEqual(newEvents(t, null).map((e) => e.text), ["Departed Facility in HONG KONG"]); // la primera vez, solo la última
  assert.deepEqual(newEvents(t, "2026-10-06T00:00:00Z").map((e) => e.text), ["Processed at HONG KONG", "Departed Facility in HONG KONG"]);
  assert.deepEqual(newEvents(t, "2026-10-08T13:10:00Z"), []);
});
