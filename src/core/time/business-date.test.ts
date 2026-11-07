import assert from "node:assert/strict";
import test from "node:test";

import { addDays, businessDate, dateOnly, daysBetween, fiscalYear, isIsoDate } from "./business-date.ts";
import { isoDate } from "./iso-date.ts";

test("businessDate is the Asia/Dhaka calendar day, whatever the server time zone is", () => {
  // Dhaka is UTC+6 with no daylight saving.
  assert.equal(businessDate(new Date("2026-11-07T17:59:59.999Z")), "2026-11-07");
  assert.equal(businessDate(new Date("2026-11-07T18:00:00.000Z")), "2026-11-08"); // 00:00 in Dhaka
  assert.equal(businessDate(new Date("2026-11-07T18:30:00.000Z")), "2026-11-08"); // 00:30 in Dhaka = a new day
  assert.equal(businessDate(new Date("2026-12-31T20:00:00.000Z")), "2027-01-01"); // year change
  assert.equal(businessDate(new Date("2028-02-28T18:00:00.000Z")), "2028-02-29"); // leap day
});

test("businessDate takes another time zone when asked", () => {
  assert.equal(businessDate(new Date("2026-11-07T18:30:00.000Z"), "UTC"), "2026-11-07");
  // New York is UTC-5 in November (standard time since 1 November 2026): midnight there is 05:00 UTC.
  assert.equal(businessDate(new Date("2026-11-07T05:00:00.000Z"), "America/New_York"), "2026-11-07");
  assert.equal(businessDate(new Date("2026-11-07T04:59:59.000Z"), "America/New_York"), "2026-11-06");
});

test("businessDate with no argument is today in Dhaka", () => {
  assert.match(businessDate(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(isIsoDate(businessDate()), true);
});

test("isIsoDate accepts only real calendar days written as YYYY-MM-DD", () => {
  for (const good of ["2026-11-07", "2028-02-29", "2000-02-29", "2026-12-31", "2026-01-01"]) {
    assert.equal(isIsoDate(good), true, good);
  }
  for (const bad of ["2026-02-31", "2027-02-29", "1900-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-1-1", "26-11-07", "2026-11-07T00:00:00Z", "", " 2026-11-07"]) {
    assert.equal(isIsoDate(bad), false, bad);
  }
});

test("the isoDate schema rejects an impossible date with a validation error, not an exception", () => {
  assert.equal(isoDate.safeParse("2026-11-07").success, true);
  assert.equal(isoDate.safeParse("2028-02-29").success, true);
  const impossible = isoDate.safeParse("2026-02-31");
  assert.equal(impossible.success, false);
  assert.equal(isoDate.safeParse("07/11/2026").success, false);
  assert.equal(isoDate.safeParse(20261107).success, false);
  assert.equal(isoDate.optional().safeParse(undefined).success, true);
});

test("dateOnly gives the stored day of a DATE column (midnight UTC) and ignores the server time zone", () => {
  assert.equal(dateOnly(new Date("2026-11-07T00:00:00.000Z")), "2026-11-07");
  assert.equal(dateOnly(new Date(Date.UTC(2028, 1, 29))), "2028-02-29");
  assert.equal(dateOnly(new Date(Date.UTC(999, 0, 5))), "0999-01-05");
});

test("fiscalYear runs July to June by default (D9) and labels it for document numbers", () => {
  assert.deepEqual(fiscalYear("2026-07-01"), { startYear: 2026, endYear: 2027, label: "2627", start: "2026-07-01", end: "2027-06-30" });
  assert.equal(fiscalYear("2026-06-30").label, "2526");
  assert.equal(fiscalYear("2026-11-07").label, "2627");
  assert.equal(fiscalYear("2027-01-15").label, "2627");
  assert.equal(fiscalYear("2099-12-31").label, "9900");
  // A calendar-year company starts in January.
  assert.deepEqual(fiscalYear("2026-11-07", 1), { startYear: 2026, endYear: 2026, label: "2626", start: "2026-01-01", end: "2026-12-31" });
  assert.throws(() => fiscalYear("2026-02-31"), RangeError);
  assert.throws(() => fiscalYear("2026-11-07", 13), RangeError);
});

test("addDays and daysBetween count calendar days across months, years and leap days", () => {
  assert.equal(addDays("2026-11-07", 3), "2026-11-10");
  assert.equal(addDays("2026-11-07", -7), "2026-10-31");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2027-02-28", 1), "2027-03-01");
  assert.equal(daysBetween("2026-11-07", "2026-11-10"), 3);
  assert.equal(daysBetween("2026-11-10", "2026-11-07"), -3);
  assert.equal(daysBetween("2028-02-28", "2028-03-01"), 2);
  assert.throws(() => addDays("2026-02-31", 1), RangeError);
});
