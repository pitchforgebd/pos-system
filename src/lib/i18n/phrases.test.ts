import assert from "node:assert/strict";
import test from "node:test";

import { PHRASES, translatePhrase } from "./phrases/index.ts";

// P13: the phrase dictionary (English sentence -> Bangla). Each Bangla text has Bangla letters, keeps the {places} of its English, and has no English word
// left but the technical names that are the same in both languages.

const TECHNICAL = new Set(["IMEI", "BIN", "TIN", "SKU", "VAT", "CSV", "Excel", "bKash", "Nagad", "DBBL", "Take", "off", "EAN", "UTC", "JPEG", "PNG", "WebP", "Dr", "Cr", "CR", "DR", "Vendor", "OWN_STOCK", "Retained", "Earnings", "Export", "SMS", "POS", "IP", "A", "x", "of", "e", "g", "per", "customer_name", "district", "offer_text", "shop_name", "due_amount", "auth", "login", "Seed", "Main", "Dhaka", "KG", "kg", "Opening", "Balance", "Equity", "Inventory", "Super", "Admin", "ID", "OK"]);

test("every phrase has a Bangla text with the same {places}, and no English word is left in it", () => {
  const problems: string[] = [];
  for (const [english, bangla] of Object.entries(PHRASES)) {
    if (!bangla.trim()) {
      problems.push(`empty: ${english}`);
      continue;
    }
    const places = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(",");
    if (places(english) !== places(bangla)) {
      problems.push(`places differ: ${english}`);
    }
    const words = (bangla.replace(/\{\w+\}/g, "").match(/[A-Za-z_]{2,}/g) ?? []).filter((word) => !TECHNICAL.has(word));
    if (words.length > 0) {
      problems.push(`English left (${words.join(" ")}): ${bangla.slice(0, 70)}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("an English sentence is looked up in Bangla; English and unknown sentences stay as they are", () => {
  assert.equal(translatePhrase("bn", "Barcode labels"), "বারকোড লেবেল");
  assert.equal(translatePhrase("en", "Barcode labels"), "Barcode labels");
  assert.equal(translatePhrase("bn", "A sentence nobody translated"), "A sentence nobody translated");
});
