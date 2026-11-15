// The language of the screens and the digits the numbers are written in (D19: Bangla by default, English as the other choice; the digits are English
// unless the person chooses Bangla digits). Both are cookies the server reads, so a page is made in the right language and the first paint is right.

export type Lang = "bn" | "en";
export type Digits = "bn" | "en";

export const DEFAULT_LANG: Lang = "bn";
export const DEFAULT_DIGITS: Digits = "en";
export const LANG_COOKIE = "meridian_lang";
export const DIGITS_COOKIE = "meridian_digits";

export const langFrom = (value: string | undefined | null): Lang => (value === "en" ? "en" : value === "bn" ? "bn" : DEFAULT_LANG);
export const digitsFrom = (value: string | undefined | null): Digits => (value === "bn" ? "bn" : DEFAULT_DIGITS);

/** What a number, a date or an amount is written with. */
export type Fmt = { lang: Lang; digits: Digits };
