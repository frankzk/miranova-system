import assert from "node:assert/strict";
import { test } from "node:test";
import { dhlNumber, dhlStatus, isDhl, parseDhlResponse } from "./tracking-dhl.ts";

const sample = {
  shipments: [
    {
      id: "1647792425",
      service: "express",
      status: {
        timestamp: "2026-10-12T10:47:00Z",
        location: { address: { addressLocality: "HONG KONG - HONG KONG", countryCode: "HK" } },
        statusCode: "transit",
        status: "transit",
        description: "Departed Facility in HONG KONG - HONG KONG",
      },
      estimatedTimeOfDelivery: "2026-10-15T23:59:00",
      events: [
        { timestamp: "2026-10-11T08:10:00Z", location: { address: { addressLocality: "SHENZHEN - CHINA MAINLAND" } }, statusCode: "pre-transit", description: "Shipment picked up" },
        { timestamp: "2026-10-12T10:47:00Z", location: { address: { addressLocality: "HONG KONG - HONG KONG", countryCode: "HK" } }, statusCode: "transit", description: "Departed Facility in HONG KONG - HONG KONG" },
        { timestamp: "no es fecha", description: "basura" },
      ],
    },
  ],
};

test("DHL: estado, última novedad, llegada estimada y novedades ordenadas", () => {
  const t = parseDhlResponse(sample, "1647792425")!;
  assert.equal(t.status, "InTransit");
  assert.equal(t.subStatus, "transit");
  assert.equal(t.latest?.text, "Departed Facility in HONG KONG - HONG KONG");
  assert.equal(t.latest?.location, "HONG KONG - HONG KONG, HK");
  assert.equal(t.latest?.at, "2026-10-12T10:47:00.000Z");
  assert.equal(t.eta, "2026-10-15");
  assert.deepEqual(t.events.map((e) => e.text), ["Departed Facility in HONG KONG - HONG KONG", "Shipment picked up"]);
});

test("DHL: entregada no tiene llegada estimada; sin envíos → null", () => {
  const delivered = { shipments: [{ id: "X1", status: { statusCode: "delivered", timestamp: "2026-10-12T10:00:00Z", description: "Delivered - Signed for by: BOXFUL" }, estimatedTimeOfDelivery: "2026-10-12" }] };
  const t = parseDhlResponse(delivered, "X1")!;
  assert.equal(t.status, "Delivered");
  assert.equal(t.eta, null);
  assert.equal(t.latest?.text, "Delivered - Signed for by: BOXFUL");
  assert.equal(parseDhlResponse({ shipments: [] }, "X"), null);
  assert.equal(parseDhlResponse(null, "X"), null);
});

test("DHL: elige el envío de la guía si vienen varios", () => {
  const two = { shipments: [{ id: "111", status: { statusCode: "delivered", timestamp: "2026-10-01T00:00:00Z", description: "otra" } }, { id: "16 4779 2425", status: { statusCode: "transit", timestamp: "2026-10-12T00:00:00Z", description: "esta" } }] };
  assert.equal(parseDhlResponse(two, "1647792425")!.latest?.text, "esta");
});

test("DHL: estados traducidos", () => {
  assert.equal(dhlStatus("pre-transit", "Shipment information received"), "InfoReceived");
  assert.equal(dhlStatus("transit", "With delivery courier"), "OutForDelivery");
  assert.equal(dhlStatus("transit", "Awaiting collection by recipient as requested"), "AvailableForPickup");
  assert.equal(dhlStatus("failure", "Delivery attempted; recipient not home"), "DeliveryFailure");
  assert.equal(dhlStatus("failure", "Shipment on hold"), "Exception");
  assert.equal(dhlStatus("unknown", null), "NotFound");
  assert.equal(dhlStatus(null, null), "NotFound");
});

test("DHL: reconoce la paquetera y limpia el número", () => {
  assert.ok(isDhl("DHL"));
  assert.ok(isDhl("dhl express"));
  assert.ok(!isDhl("FedEx"));
  assert.ok(!isDhl(null));
  assert.equal(dhlNumber("16 4779-2425"), "1647792425");
});
