import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchDelayHours, groupOf, lateDispatchCutoff, UNDISPATCHED_CODES, waitLabel } from "./status.ts";

const NOW = Date.parse("2026-10-09T18:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

test("retraso de despacho: sin 'Orden despachada' pasadas 36 h", () => {
  assert.equal(dispatchDelayHours("registered", hoursAgo(35.9), NOW), null);
  assert.equal(dispatchDelayHours("registered", hoursAgo(36), NOW), 36);
  assert.equal(dispatchDelayHours("registered", hoursAgo(52.5), NOW), 52);
  assert.equal(dispatchDelayHours("pending", hoursAgo(80), NOW), 80);
});

test("retraso de despacho: las ya despachadas o en otro grupo no cuentan", () => {
  assert.equal(dispatchDelayHours("fulfilled", hoursAgo(100), NOW), null); // "Orden despachada", sin recolectar
  assert.equal(dispatchDelayHours("-1", hoursAgo(100), NOW), null);
  assert.equal(dispatchDelayHours("3", hoursAgo(100), NOW), null);
  assert.equal(dispatchDelayHours(null, hoursAgo(100), NOW), null);
  assert.equal(dispatchDelayHours("registered", null, NOW), null);
});

test("los estados sin despachar son de Por despachar", () => {
  for (const c of UNDISPATCHED_CODES) assert.equal(groupOf(c), "dispatch");
});

test("corte de 36 h", () => {
  assert.equal(lateDispatchCutoff(NOW).toISOString(), "2026-10-08T06:00:00.000Z");
});

test("etiqueta del tiempo de espera", () => {
  assert.equal(waitLabel(36), "36 h");
  assert.equal(waitLabel(47), "47 h");
  assert.equal(waitLabel(52), "2 d 4 h");
  assert.equal(waitLabel(72), "3 d");
});
