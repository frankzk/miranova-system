import assert from "node:assert/strict";
import { test } from "node:test";
import { fedexStatus, isFedex, parseFedexResponse } from "./tracking-fedex.ts";
import { isUps, parseUpsResponse, upsStatus } from "./tracking-ups.ts";

const fedex = {
  output: {
    completeTrackResults: [
      {
        trackingNumber: "771234567890",
        trackResults: [
          {
            latestStatusDetail: { code: "IT", derivedCode: "IT", description: "In transit", scanLocation: { city: "MEMPHIS", stateOrProvinceCode: "TN", countryCode: "US" } },
            dateAndTimes: [{ type: "ACTUAL_PICKUP", dateTime: "2026-10-09T10:00:00+08:00" }, { type: "ESTIMATED_DELIVERY", dateTime: "2026-10-16T18:00:00-06:00" }],
            scanEvents: [
              { date: "2026-10-09T10:00:00+08:00", eventDescription: "Picked up", derivedStatusCode: "PU", scanLocation: { city: "SHENZHEN", countryCode: "CN" } },
              { date: "2026-10-12T04:30:00-05:00", eventDescription: "Departed FedEx hub", derivedStatusCode: "IT", scanLocation: { city: "MEMPHIS", stateOrProvinceCode: "TN", countryCode: "US" } },
            ],
          },
        ],
      },
    ],
  },
};

test("FedEx: estado, última novedad (la más reciente), llegada estimada", () => {
  const r = parseFedexResponse(fedex, "7712 3456 7890");
  assert.ok(r.found);
  if (!r.found) return;
  assert.equal(r.info.status, "InTransit");
  assert.equal(r.info.subStatus, "IT");
  assert.equal(r.info.latest?.text, "Departed FedEx hub");
  assert.equal(r.info.latest?.location, "MEMPHIS, TN, US");
  assert.equal(r.info.latest?.at, "2026-10-12T09:30:00.000Z");
  assert.equal(r.info.eta, "2026-10-16");
  assert.deepEqual(r.info.events.map((e) => e.text), ["Departed FedEx hub", "Picked up"]);
});

test("FedEx: guía no encontrada y estados", () => {
  const nf = { output: { completeTrackResults: [{ trackingNumber: "1", trackResults: [{ error: { code: "TRACKING.TRACKINGNUMBER.NOTFOUND", message: "Tracking number cannot be found. Please correct the tracking number and try again." } }] }] } };
  const r = parseFedexResponse(nf, "1");
  assert.equal(r.found, false);
  assert.equal(!r.found && r.message, "FedEx todavía no tiene información de esta guía.");
  assert.equal(parseFedexResponse({}, "1").found, false);
  assert.equal(fedexStatus("DL", null), "Delivered");
  assert.equal(fedexStatus("OD", null), "OutForDelivery");
  assert.equal(fedexStatus("DE", null), "DeliveryFailure");
  assert.equal(fedexStatus("CD", "Clearance delay"), "Exception");
  assert.equal(fedexStatus("OC", null), "InfoReceived");
  assert.equal(fedexStatus("AR", "At local FedEx facility"), "InTransit");
  assert.equal(fedexStatus("AR", "Ready for pickup at FedEx location"), "AvailableForPickup");
  const delivered = { output: { completeTrackResults: [{ trackingNumber: "2", trackResults: [{ latestStatusDetail: { code: "DL", description: "Delivered" }, dateAndTimes: [{ type: "ESTIMATED_DELIVERY", dateTime: "2026-10-10T00:00:00Z" }], scanEvents: [{ date: "2026-10-10T15:00:00Z", eventDescription: "Delivered" }] }] }] } };
  const d = parseFedexResponse(delivered, "2");
  assert.ok(d.found && d.info.status === "Delivered" && d.info.eta === null);
});

const ups = {
  trackResponse: {
    shipment: [
      {
        inquiryNumber: "1Z999AA10123456784",
        package: [
          {
            trackingNumber: "1Z999AA10123456784",
            deliveryDate: [{ type: "SDD", date: "20261016" }],
            currentStatus: { description: "On the Way", code: "005" },
            activity: [
              { location: { address: { city: "Louisville", stateProvince: "KY", countryCode: "US" } }, status: { type: "I", description: "Departed from Facility", code: "DP" }, date: "20261012", time: "043000", gmtDate: "20261012", gmtTime: "09:30:00" },
              { location: { address: { city: "Shenzhen", countryCode: "CN" } }, status: { type: "P", description: "Pickup Scan", code: "PU" }, date: "20261009", time: "100000" },
            ],
          },
        ],
      },
    ],
  },
};

test("UPS: estado, última novedad en hora GMT, llegada programada", () => {
  const r = parseUpsResponse(ups, "1Z999AA10123456784");
  assert.ok(r.found);
  if (!r.found) return;
  assert.equal(r.info.status, "InTransit");
  assert.equal(r.info.latest?.text, "Departed from Facility");
  assert.equal(r.info.latest?.location, "Louisville, KY, US");
  assert.equal(r.info.latest?.at, "2026-10-12T09:30:00.000Z");
  assert.equal(r.info.eta, "2026-10-16");
  assert.deepEqual(r.info.events.map((e) => e.text), ["Departed from Facility", "Pickup Scan"]);
});

test("UPS: sin información y estados", () => {
  const nf = { trackResponse: { shipment: [{ inquiryNumber: "1Z0", warnings: [{ code: "TW0001", message: "Tracking Information Not Found" }] }] } };
  const r = parseUpsResponse(nf, "1Z0");
  assert.equal(r.found, false);
  assert.equal(!r.found && r.message, "UPS todavía no tiene información de esta guía.");
  assert.equal(upsStatus("D", "Delivered"), "Delivered");
  assert.equal(upsStatus("I", "Out For Delivery Today"), "OutForDelivery");
  assert.equal(upsStatus("O", null), "OutForDelivery");
  assert.equal(upsStatus("X", "The receiver was not available for delivery"), "DeliveryFailure");
  assert.equal(upsStatus("X", "Clearance information required"), "Exception");
  assert.equal(upsStatus("M", "Shipper created a label"), "InfoReceived");
  assert.equal(upsStatus("I", "Delivered to UPS Access Point. Ready for pickup"), "AvailableForPickup");
});

test("paqueteras: reconoce el nombre", () => {
  assert.ok(isFedex("FedEx") && isFedex("Fed Ex Express") && !isFedex("DHL"));
  assert.ok(isUps("UPS") && isUps("ups worldwide") && !isUps("USPS") && !isUps(null));
});
