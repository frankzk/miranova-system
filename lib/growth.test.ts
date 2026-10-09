import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clock, dayMonth, monthProgress, monthProjection, monthShort, monthToDateLabels, pctChange, toDate, trimLeading, weekRange, weekToDateLabel,
  type OrderGrowth,
} from "./growth.ts";

const g: OrderGrowth = {
  now: "2026-10-09T11:10",
  weeks: [{ k: 2, start: "2026-09-21", orders: 1531 }, { k: 1, start: "2026-09-28", orders: 1249 }, { k: 0, start: "2026-10-05", orders: 495 }],
  months: [{ k: 2, month: "2026-08", orders: 0 }, { k: 1, month: "2026-09", orders: 5847 }, { k: 0, month: "2026-10", orders: 1108 }],
  week_prev_to_date: 862,
  month_prev_to_date: 1078,
};

test("cambio relativo y sin base", () => {
  assert.equal(pctChange(110, 100), 0.1);
  assert.equal(pctChange(5, 0), null);
});

test("período en curso contra el mismo tramo del anterior", () => {
  const w = toDate(g, "week");
  assert.deepEqual([w.current, w.prev, w.prevFull], [495, 862, 1249]);
  assert.equal(Math.round(w.change! * 100), -43);
  const m = toDate(g, "month");
  assert.deepEqual([m.current, m.prev, m.prevFull], [1108, 1078, 5847]);
  assert.equal(Math.round(m.change! * 100), 3);
});

test("progreso del mes y cierre estimado (no en la primera semana)", () => {
  const p = monthProgress("2026-10-09T12:00");
  assert.equal(p.days, 31);
  assert.equal(p.elapsed, 8.5);
  assert.equal(monthProgress("2026-02-28T00:00").days, 28);
  assert.equal(monthProjection({ ...g, now: "2026-10-09T12:00" }), Math.round((1108 / 8.5) * 31));
  assert.equal(monthProjection({ ...g, now: "2026-10-05T12:00" }), null);
});

test("meses vacíos del principio fuera", () => {
  assert.deepEqual(trimLeading(g.months).map((m) => m.month), ["2026-09", "2026-10"]);
  assert.deepEqual(trimLeading([{ orders: 0 }]), []);
});

test("etiquetas en español", () => {
  assert.equal(clock("2026-10-09T11:10"), "11:10 a. m.");
  assert.equal(clock("2026-10-09T00:05"), "12:05 a. m.");
  assert.equal(clock("2026-10-09T15:40"), "3:40 p. m.");
  assert.equal(weekToDateLabel("2026-10-09T11:10"), "lun a vie, hasta las 11:10 a. m.");
  assert.equal(weekToDateLabel("2026-10-05T09:00"), "el lunes, hasta las 9:00 a. m.");
  assert.deepEqual(monthToDateLabels("2026-10-09T11:10"), { current: "1–9 oct", prev: "1–9 sept" });
  // marzo 30 contra febrero: hasta su último día
  assert.deepEqual(monthToDateLabels("2026-03-30T10:00"), { current: "1–30 mar", prev: "1–28 feb" });
  assert.deepEqual(monthToDateLabels("2026-01-01T10:00"), { current: "1 ene", prev: "1 dic" });
  assert.equal(weekRange("2026-09-28"), "28 sept – 4 oct");
  assert.equal(weekRange("2026-10-05"), "5 – 11 oct");
  assert.equal(dayMonth("2026-07-20"), "20 jul");
  assert.equal(monthShort("2025-12", "2026-02-01T00:00"), "dic 25");
});
