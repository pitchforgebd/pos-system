// An amount of taka written out in words, as invoices and receipts in Bangladesh carry it ("Taka One Lakh Twenty Thousand Only"), in the
// lakh and crore system, in English or Bangla. The paisa are written after the taka.

const EN_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const EN_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

// Bangla has its own word for every number from 0 to 99
const BN = (
  "শূন্য এক দুই তিন চার পাঁচ ছয় সাত আট নয় দশ এগারো বারো তেরো চৌদ্দ পনেরো ষোলো সতেরো আঠারো উনিশ বিশ একুশ বাইশ তেইশ চব্বিশ পঁচিশ ছাব্বিশ সাতাশ আটাশ উনত্রিশ ত্রিশ " +
  "একত্রিশ বত্রিশ তেত্রিশ চৌত্রিশ পঁয়ত্রিশ ছত্রিশ সাঁইত্রিশ আটত্রিশ উনচল্লিশ চল্লিশ একচল্লিশ বিয়াল্লিশ তেতাল্লিশ চুয়াল্লিশ পঁয়তাল্লিশ ছেচল্লিশ সাতচল্লিশ আটচল্লিশ উনপঞ্চাশ পঞ্চাশ " +
  "একান্ন বাহান্ন তিপ্পান্ন চুয়ান্ন পঞ্চান্ন ছাপ্পান্ন সাতান্ন আটান্ন উনষাট ষাট একষট্টি বাষট্টি তেষট্টি চৌষট্টি পঁয়ষট্টি ছেষট্টি সাতষট্টি আটষট্টি উনসত্তর সত্তর " +
  "একাত্তর বাহাত্তর তিয়াত্তর চুয়াত্তর পঁচাত্তর ছিয়াত্তর সাতাত্তর আটাত্তর উনআশি আশি একাশি বিরাশি তিরাশি চুরাশি পঁচাশি ছিয়াশি সাতাশি আটাশি উননব্বই নব্বই " +
  "একানব্বই বিরানব্বই তিরানব্বই চুরানব্বই পঁচানব্বই ছিয়ানব্বই সাতানব্বই আটানব্বই নিরানব্বই"
).split(" ");

function enBelowHundred(n: number) {
  return n < 20 ? EN_ONES[n] : `${EN_TENS[Math.floor(n / 10)]}${n % 10 ? ` ${EN_ONES[n % 10]}` : ""}`;
}

function enBelowThousand(n: number) {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  return [hundred ? `${EN_ONES[hundred]} Hundred` : "", rest ? enBelowHundred(rest) : ""].filter(Boolean).join(" ");
}

/** Whole numbers in the lakh and crore system. */
function wholeWords(n: number, lang: "en" | "bn"): string {
  if (n === 0) {
    return lang === "bn" ? BN[0] : "Zero";
  }
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const hundred = Math.floor((n % 1000) / 100);
  const rest = n % 100;
  if (lang === "bn") {
    if (crore) parts.push(`${wholeWords(crore, "bn")} কোটি`);
    if (lakh) parts.push(`${BN[lakh]} লক্ষ`);
    if (thousand) parts.push(`${BN[thousand]} হাজার`);
    if (hundred) parts.push(`${BN[hundred]}শ`);
    if (rest) parts.push(BN[rest]);
    return parts.join(" ");
  }
  if (crore) parts.push(`${wholeWords(crore, "en")} Crore`);
  if (lakh) parts.push(`${enBelowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${enBelowHundred(thousand)} Thousand`);
  const small = hundred * 100 + rest;
  if (small) parts.push(enBelowThousand(small));
  return parts.join(" ");
}

/** "Taka One Thousand Two Hundred Fifty and Fifty Paisa Only" / "এক হাজার দুইশ পঞ্চাশ টাকা পঞ্চাশ পয়সা মাত্র". `amount` is "1250.50". */
export function takaInWords(amount: string, lang: "en" | "bn" = "en") {
  const negative = amount.trim().startsWith("-");
  const [whole = "0", fraction = ""] = amount.trim().replace("-", "").split(".");
  const taka = Number(whole);
  const paisa = Number(`${fraction}00`.slice(0, 2));
  if (!Number.isSafeInteger(taka)) {
    return amount;
  }
  if (lang === "bn") {
    const text = `${wholeWords(taka, "bn")} টাকা${paisa ? ` ${BN[paisa]} পয়সা` : ""} মাত্র`;
    return negative ? `ঋণাত্মক ${text}` : text;
  }
  const text = `Taka ${wholeWords(taka, "en")}${paisa ? ` and ${enBelowHundred(paisa)} Paisa` : ""} Only`;
  return negative ? `Minus ${text}` : text;
}
