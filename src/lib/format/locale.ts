import type { Digits, Fmt, Lang } from "@/lib/i18n/lang";

// Numbers, money and dates as people read them here (P13 tasks 3 and 4): taka with the lakh and crore grouping (৳12,34,567.00), the digits English or
// Bangla as the person chose, dates and times in Dhaka time with the month in Bangla or English. Display only: nothing here is arithmetic, and a value
// that is not a number is shown as it came.

const BANGLA_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

/** Replaces the digits 0-9 of a text with Bangla digits. */
export function toBanglaDigits(text: string) {
  return text.replace(/[0-9]/g, (digit) => BANGLA_DIGITS[Number(digit)]);
}

/** Written with the chosen digits. */
export function withDigits(text: string, digits: Digits) {
  return digits === "bn" ? toBanglaDigits(text) : text;
}

/** 1234567 -> 12,34,567 (the last three digits, then pairs). */
export function groupLakh(integerDigits: string) {
  if (integerDigits.length <= 3) {
    return integerDigits;
  }
  const last = integerDigits.slice(-3);
  const rest = integerDigits.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last}`;
}

const PLAIN = /^-?\d+(\.\d+)?$/;

/** 129 -> 130, 999 -> 1000: one added to a text of digits, with no limit on its length. */
function addOne(digits: string) {
  const chars = digits.split("");
  let at = chars.length - 1;
  while (at >= 0) {
    if (chars[at] === "9") {
      chars[at] = "0";
      at -= 1;
    } else {
      chars[at] = String(Number(chars[at]) + 1);
      return chars.join("");
    }
  }
  return `1${chars.join("")}`;
}

/** A number as text with a fixed count of decimals and the lakh grouping, English digits: the exact digits of a plain decimal text are kept. */
function fixed(value: string | number, decimals: number) {
  const text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value.trim();
  if (!PLAIN.test(text) && !/^-?\d+(\.\d+)?e[+-]?\d+$/i.test(text)) {
    return null;
  }
  let negative = text.startsWith("-");
  let [whole, fraction = ""] = text.replace("-", "").split(".");
  if (/e/i.test(text)) {
    const n = Number(text);
    negative = n < 0;
    [whole, fraction = ""] = Math.abs(n).toFixed(decimals).split(".");
  }
  if (fraction.length > decimals) {
    // round half away from zero on the text, so 2.675 is 2.68 and not what the binary number happens to be
    const keep = fraction.slice(0, decimals);
    const up = Number(fraction[decimals]) >= 5;
    let digits = `${whole}${keep}`;
    if (up) {
      digits = addOne(digits);
    }
    whole = decimals > 0 ? digits.slice(0, digits.length - decimals) || "0" : digits;
    fraction = decimals > 0 ? digits.slice(-decimals) : "";
  } else {
    fraction = fraction.padEnd(decimals, "0");
  }
  whole = whole.replace(/^0+(?=\d)/, "");
  const zero = /^0*$/.test(whole) && /^0*$/.test(fraction);
  return { negative: negative && !zero, whole, fraction };
}

/** 1234567.5 -> 12,34,567.50 (no symbol). */
export function formatNumber(value: string | number | null | undefined, options: { digits?: Digits; decimals?: number } = {}) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const parts = fixed(value, options.decimals ?? 2);
  if (!parts) {
    return String(value);
  }
  const text = `${parts.negative ? "-" : ""}${groupLakh(parts.whole)}${parts.fraction ? `.${parts.fraction}` : ""}`;
  return withDigits(text, options.digits ?? "en");
}

/** A count: no decimals, lakh grouping (1,25,000). */
export function formatCount(value: string | number | null | undefined, digits: Digits = "en") {
  return formatNumber(value, { digits, decimals: 0 });
}

/** An amount in taka: ৳12,34,567.00 (or ৳১২,৩৪,৫৬৭.০০ with Bangla digits); a minus sign comes first: -৳500.00. */
export function formatTaka(value: string | number | null | undefined, options: { digits?: Digits; decimals?: number } = {}) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (!fixed(value, options.decimals ?? 2)) {
    return String(value);
  }
  const number = formatNumber(value, options);
  return number.startsWith("-") ? `-৳${number.slice(1)}` : `৳${number}`;
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_BN = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_BN = ["রবি", "সোম", "মঙ্গল", "বুধ", "বৃহস্পতি", "শুক্র", "শনি"];

export const monthName = (month: number, lang: Lang) => (lang === "bn" ? MONTHS_BN : MONTHS_EN)[month - 1] ?? "";
export const weekdayName = (index: number, lang: Lang) => (lang === "bn" ? WEEKDAYS_BN : WEEKDAYS_EN)[index] ?? "";

/** A business date (YYYY-MM-DD) as 16 নভেম্বর 2026 or 16 Nov 2026. A text that is not a date comes back as it was. */
export function formatDate(isoDate: string | null | undefined, fmt: Fmt) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate ?? "");
  if (!match) {
    return isoDate ?? "";
  }
  const [, year, month, day] = match;
  return withDigits(`${Number(day)} ${monthName(Number(month), fmt.lang)} ${year}`, fmt.digits);
}

/** Day and month only: 16 নভেম্বর. */
export function formatDayMonth(isoDate: string, fmt: Fmt) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) {
    return isoDate;
  }
  return withDigits(`${Number(match[3])} ${monthName(Number(match[2]), fmt.lang)}`, fmt.digits);
}

/** The weekday of a business date, short: সোম / Mon. */
export function formatWeekday(isoDate: string, fmt: Fmt) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) {
    return "";
  }
  return weekdayName(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay(), fmt.lang);
}

const dhaka = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** A moment in Dhaka time: 16 নভেম্বর 2026, 14:05 (the shop's day, never the server's time zone). */
export function formatDateTime(value: Date | string | null | undefined, fmt: Fmt, options: { seconds?: boolean } = {}) {
  if (!value) {
    return "";
  }
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const part = Object.fromEntries(dhaka.formatToParts(date).map((row) => [row.type, row.value]));
  const time = `${part.hour}:${part.minute}${options.seconds ? `:${part.second}` : ""}`;
  return withDigits(`${Number(part.day)} ${monthName(Number(part.month), fmt.lang)} ${part.year}, ${time}`, fmt.digits);
}

/**
 * A short amount for a chart label: ৳54,720 below a lakh, then ৳1.9 লাখ / ৳1.9 L and ৳1.2 কোটি / ৳1.2 Cr (the words of the language). The full amount belongs
 * in the tooltip: this one is rounded.
 */
export function formatTakaCompact(value: string | number | null | undefined, fmt: Fmt) {
  const number = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(number)) {
    return "";
  }
  const abs = Math.abs(number);
  const sign = number < 0 ? "-" : "";
  const bn = fmt.lang === "bn";
  const one = (n: number) => String(Math.round(n * 10) / 10);
  if (abs >= 10_000_000) {
    return `${sign}৳${withDigits(one(abs / 10_000_000), fmt.digits)} ${bn ? "কোটি" : "Cr"}`;
  }
  if (abs >= 100_000) {
    return `${sign}৳${withDigits(one(abs / 100_000), fmt.digits)} ${bn ? "লাখ" : "L"}`;
  }
  return formatTaka(number < 0 ? -Math.round(abs) : Math.round(abs), { digits: fmt.digits, decimals: 0 });
}

/** A quantity: the decimals it really has and no more (2.5000 -> 2.5, 3.0000 -> 3), lakh grouping, the chosen digits. */
export function formatQty(value: string | number | null | undefined, digits: Digits = "en") {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!PLAIN.test(text)) {
    return String(value);
  }
  const trimmed = text.includes(".") ? text.replace(/0+$/u, "").replace(/\.$/u, "") : text;
  return formatNumber(trimmed, { digits, decimals: trimmed.includes(".") ? trimmed.split(".")[1].length : 0 });
}
