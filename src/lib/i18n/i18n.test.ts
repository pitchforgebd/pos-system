import assert from "node:assert/strict";
import test from "node:test";

import { formatQty, formatTakaCompact, formatCount, formatDate, formatDateTime, formatDayMonth, formatNumber, formatTaka, formatWeekday, groupLakh, toBanglaDigits } from "../format/locale.ts";
import { referenceNavigation } from "../../constants/reference-nav.ts";
import { digitsFrom, langFrom } from "./lang.ts";
import { translateNav } from "./nav.ts";
import { areas, messagesFor } from "./messages/index.ts";
import { fill, makeT } from "./translate.ts";

// P13 tasks 1, 3 and 4: the text catalog has the same keys in both languages, money is written with the lakh grouping, dates are Dhaka time.

test("taka: the lakh and crore grouping, two decimals, Bangla digits when chosen", () => {
  assert.equal(formatTaka("1234567.5", { digits: "bn" }), "৳১২,৩৪,৫৬৭.৫০");
  assert.equal(formatTaka("1234567.5"), "৳12,34,567.50");
  assert.equal(formatTaka(0), "৳0.00");
  assert.equal(formatTaka("999"), "৳999.00");
  assert.equal(formatTaka("1000"), "৳1,000.00");
  assert.equal(formatTaka("100000"), "৳1,00,000.00");
  assert.equal(formatTaka("123456789.1"), "৳12,34,56,789.10");
  assert.equal(formatTaka(-500), "-৳500.00");
  assert.equal(formatTaka("-1234567.89", { digits: "bn" }), "-৳১২,৩৪,৫৬৭.৮৯");
  assert.equal(formatTaka("-0.001"), "৳0.00", "a tiny negative is not shown as -0.00");
  assert.equal(formatTaka(1234.5), "৳1,234.50");
});

test("rounding is on the digits of the text (half up), never on a binary number", () => {
  assert.equal(formatTaka("2.675"), "৳2.68");
  assert.equal(formatTaka("0.005"), "৳0.01");
  assert.equal(formatTaka("0.004"), "৳0.00");
  assert.equal(formatTaka("999999.995"), "৳10,00,000.00");
  assert.equal(formatTaka("12345678901234567.895"), "৳12,34,56,78,90,12,34,567.90", "more digits than a double holds, kept exactly");
});

test("a value that is not a number is shown as it came; nothing is invented for empty", () => {
  assert.equal(formatTaka("abc"), "abc");
  assert.equal(formatTaka(""), "");
  assert.equal(formatTaka(null), "");
  assert.equal(formatTaka(undefined), "");
  assert.equal(formatNumber("12abc"), "12abc");
});

test("numbers and counts", () => {
  assert.equal(formatNumber("1234567.5", { decimals: 1 }), "12,34,567.5");
  assert.equal(formatCount(125000), "1,25,000");
  assert.equal(formatCount("125000", "bn"), "১,২৫,০০০");
  assert.equal(formatCount(7), "7");
  assert.equal(groupLakh("1234567"), "12,34,567");
  assert.equal(toBanglaDigits("Tk 1,250.50"), "Tk ১,২৫০.৫০");
});

test("dates: day, month name in the language, year; digits as chosen", () => {
  assert.equal(formatDate("2026-11-16", { lang: "bn", digits: "en" }), "16 নভেম্বর 2026");
  assert.equal(formatDate("2026-11-16", { lang: "bn", digits: "bn" }), "১৬ নভেম্বর ২০২৬");
  assert.equal(formatDate("2026-01-05", { lang: "en", digits: "en" }), "5 Jan 2026");
  assert.equal(formatDate("not a date", { lang: "bn", digits: "en" }), "not a date");
  assert.equal(formatDate(null, { lang: "bn", digits: "en" }), "");
  assert.equal(formatDayMonth("2026-11-16", { lang: "bn", digits: "bn" }), "১৬ নভেম্বর");
  assert.equal(formatWeekday("2026-11-16", { lang: "bn", digits: "en" }), "সোম");
  assert.equal(formatWeekday("2026-11-16", { lang: "en", digits: "en" }), "Mon");
});

test("a moment is shown in Dhaka time, whatever the server's zone is", () => {
  // 18:30 UTC is half past midnight of the next day in Dhaka (UTC+6)
  assert.equal(formatDateTime(new Date("2026-11-16T18:30:00.000Z"), { lang: "bn", digits: "en" }), "17 নভেম্বর 2026, 00:30");
  assert.equal(formatDateTime("2026-11-16T05:05:09.000Z", { lang: "en", digits: "bn" }, { seconds: true }), "১৬ Nov ২০২৬, ১১:০৫:০৯");
  assert.equal(formatDateTime(null, { lang: "bn", digits: "en" }), "");
});

test("language and digits come from the cookies, Bangla and English digits by default (D19)", () => {
  assert.equal(langFrom(undefined), "bn");
  assert.equal(langFrom("en"), "en");
  assert.equal(langFrom("fr"), "bn");
  assert.equal(digitsFrom(undefined), "en");
  assert.equal(digitsFrom("bn"), "bn");
});

test("the catalog: the same keys in Bangla and English, no key in two areas, the same {places} in both, no empty text", () => {
  const seen = new Map<string, string>();
  for (const [name, one] of Object.entries(areas)) {
    const en = Object.keys(one.en).sort();
    const bn = Object.keys(one.bn).sort();
    assert.deepEqual(bn, en, `${name}: Bangla and English keys`);
    for (const key of en) {
      assert.equal(key.startsWith(`${name}.`), true, `${key} belongs to the area ${name}`);
      assert.equal(seen.has(key), false, `${key} is in two areas`);
      seen.set(key, name);
      const english = (one.en as Record<string, string>)[key];
      const bangla = (one.bn as Record<string, string>)[key];
      assert.ok(english.trim() && bangla.trim(), `${key} has text in both languages`);
      const places = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      assert.deepEqual(places(bangla), places(english), `${key}: the same {places}`);
      assert.equal(/[A-Za-z]{4,}/.test(bangla.replace(/\{\w+\}/g, "").replace(/Vendor|Tk|SMS|CSV|POS|VAT|Bangla|English|qwerty|Take-off|Meridian|Walk-in|SKU|IMEI/g, "")), false, `${key}: Bangla text has English words left: ${bangla}`);
    }
  }
});

test("t fills the places and shows a missing key instead of nothing", () => {
  const t = makeT(messagesFor("en", ["dashboard"]), "en");
  assert.equal(t("dashboard.up", { pct: "12%" }), "12% more than yesterday");
  assert.equal(fill("{a} and {b}", { a: 1 }), "1 and {b}");
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    assert.equal(t("nothing.here" as never), "nothing.here");
  } finally {
    console.warn = warn;
  }
  assert.equal(messagesFor("bn", [])["common.save"], "সংরক্ষণ");
});

test("a short amount for a chart: the full figure below a lakh, then lakh and crore in the words of the language", () => {
  const bn = { lang: "bn", digits: "bn" } as const;
  const en = { lang: "en", digits: "en" } as const;
  assert.equal(formatTakaCompact("54720.00", en), "৳54,720");
  assert.equal(formatTakaCompact("374690", bn), "৳৩.৭ লাখ");
  assert.equal(formatTakaCompact("100000", en), "৳1 L");
  assert.equal(formatTakaCompact("12500000", en), "৳1.3 Cr");
  assert.equal(formatTakaCompact("12500000", bn), "৳১.৩ কোটি");
  assert.equal(formatTakaCompact("0.00", en), "৳0");
  assert.equal(formatTakaCompact("-250000", en), "-৳2.5 L");
  assert.equal(formatTakaCompact("abc", en), "");
});

test("every menu label has a Bangla text", () => {
  const labels = new Set<string>();
  const walk = (entries: ReadonlyArray<{ label: string; children?: ReadonlyArray<{ label: string; children?: ReadonlyArray<{ label: string }> }> }>) => {
    for (const entry of entries) {
      labels.add(entry.label);
      walk(entry.children ?? []);
    }
  };
  walk(referenceNavigation as never);
  const missing = [...labels].filter((label) => translateNav("bn", label) === label);
  assert.deepEqual(missing, [], "menu labels with no Bangla text");
});

test("a quantity keeps the decimals it really has", () => {
  assert.equal(formatQty("2.5000"), "2.5");
  assert.equal(formatQty("3.0000"), "3");
  assert.equal(formatQty("1250.125"), "1,250.125");
  assert.equal(formatQty("2.5", "bn"), "২.৫");
  assert.equal(formatQty(""), "");
  assert.equal(formatQty("x"), "x");
});
