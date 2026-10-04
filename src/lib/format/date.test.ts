import assert from "node:assert/strict";
import test from "node:test";

import { daysInMonth, toIsoDate } from "./date.ts";

test("daysInMonth knows leap February", () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2026, 9), 30);
});

test("toIsoDate pads month and day", () => {
  assert.equal(toIsoDate(2026, 9, 3), "2026-09-03");
});
