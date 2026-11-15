import { formatCount, formatDate, formatDateTime, formatDayMonth, formatNumber, formatQty, formatTaka, formatWeekday } from "@/lib/format/locale";
import type { Digits, Fmt, Lang } from "@/lib/i18n/lang";
import type { MessageKey } from "@/lib/i18n/messages";
import { makeT, type Params } from "@/lib/i18n/translate";

// One object with everything a screen needs to write in the person's language: the texts and the number, money and date formats. The server makes it from
// the cookies; a client component gets the same thing from the provider.

export type I18n = {
  lang: Lang;
  digits: Digits;
  fmt: Fmt;
  t: (key: MessageKey, params?: Params) => string;
  /** ৳12,34,567.00 */
  taka: (value: string | number | null | undefined) => string;
  /** 12,34,567.50 */
  num: (value: string | number | null | undefined, decimals?: number) => string;
  /** 2.5 or 3 (the decimals a quantity really has) */
  qty: (value: string | number | null | undefined) => string;
  /** 1,25,000 */
  count: (value: string | number | null | undefined) => string;
  date: (isoDate: string | null | undefined) => string;
  dayMonth: (isoDate: string) => string;
  weekday: (isoDate: string) => string;
  dateTime: (value: Date | string | null | undefined, options?: { seconds?: boolean }) => string;
};

export function buildI18n(prefs: Fmt, messages: Readonly<Record<string, string>>): I18n {
  const { lang, digits } = prefs;
  return {
    lang,
    digits,
    fmt: prefs,
    t: makeT<MessageKey>(messages, lang),
    taka: (value) => formatTaka(value, { digits }),
    num: (value, decimals) => formatNumber(value, { digits, decimals }),
    qty: (value) => formatQty(value, digits),
    count: (value) => formatCount(value, digits),
    date: (isoDate) => formatDate(isoDate, prefs),
    dayMonth: (isoDate) => formatDayMonth(isoDate, prefs),
    weekday: (isoDate) => formatWeekday(isoDate, prefs),
    dateTime: (value, options) => formatDateTime(value, prefs, options),
  };
}
