import assert from "node:assert/strict";
import test from "node:test";

import { takaInWords } from "./words.ts";

// The amount in words on invoices and receipts (added after the 16-day user test found the printed invoice bare).
test("taka in words, English, lakh and crore", () => {
  assert.equal(takaInWords("0.00"), "Taka Zero Only");
  assert.equal(takaInWords("2730.00"), "Taka Two Thousand Seven Hundred Thirty Only");
  assert.equal(takaInWords("21160.50"), "Taka Twenty One Thousand One Hundred Sixty and Fifty Paisa Only");
  assert.equal(takaInWords("125000.00"), "Taka One Lakh Twenty Five Thousand Only");
  assert.equal(takaInWords("12345678.09"), "Taka One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Nine Paisa Only");
  assert.equal(takaInWords("-80.00"), "Minus Taka Eighty Only");
});

test("taka in words, Bangla", () => {
  assert.equal(takaInWords("2730.00", "bn"), "দুই হাজার সাতশ ত্রিশ টাকা মাত্র");
  assert.equal(takaInWords("125000.25", "bn"), "এক লক্ষ পঁচিশ হাজার টাকা পঁচিশ পয়সা মাত্র");
  assert.equal(takaInWords("99.00", "bn"), "নিরানব্বই টাকা মাত্র");
  assert.equal(takaInWords("15500.00", "bn"), "পনেরো হাজার পাঁচশ টাকা মাত্র");
});
