import assert from "node:assert/strict";
import test from "node:test";

import { daysInMonth, isIsoDate, occurredDate, toIsoDate } from "./date.ts";

test("daysInMonth knows leap February", () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2026, 9), 30);
});

test("toIsoDate pads month and day", () => {
  assert.equal(toIsoDate(2026, 9, 3), "2026-09-03");
});

test("occurredDate gives UTC midnight and rejects impossible days", () => {
  assert.equal(occurredDate("2026-10-01").toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(isIsoDate("2024-02-29"), true);
  assert.equal(isIsoDate("2026-02-31"), false);
  assert.equal(isIsoDate("2026-10-01T05:00:00+06:00"), false);
  assert.equal(isIsoDate("10/01/2026"), false);
  assert.throws(() => occurredDate("2026-02-31"), RangeError);
});
