import { PHRASES_BASE } from "@/lib/i18n/phrases/base";
import { PHRASES_ENUMS } from "@/lib/i18n/phrases/enums";
import { PHRASES_1 } from "@/lib/i18n/phrases/p1";
import { PHRASES_2 } from "@/lib/i18n/phrases/p2";
import { PHRASES_3 } from "@/lib/i18n/phrases/p3";
import { PHRASES_4 } from "@/lib/i18n/phrases/p4";
import { PHRASES_5 } from "@/lib/i18n/phrases/p5";
import { PHRASES_6 } from "@/lib/i18n/phrases/p6";

// The Bangla of the English sentences the screens write directly (a title, a column header, a button, a hint). The English text is the key. A screen that
// is not yet moved to the keyed catalog (src/lib/i18n/messages) uses `ph("English text")`: in Bangla it finds the text here, and a text that is not here
// is shown as it is (in English), which a crawl of the screens lists. Several files may be added below as the dictionary grows.

export const PHRASES: Readonly<Record<string, string>> = { ...PHRASES_BASE, ...PHRASES_ENUMS, ...PHRASES_1, ...PHRASES_2, ...PHRASES_3, ...PHRASES_4, ...PHRASES_5, ...PHRASES_6 };

/** The text in the language of the screen: English stays, Bangla is looked up (and stays English when the dictionary has nothing for it). */
export function translatePhrase(lang: "bn" | "en", text: string) {
  return lang === "bn" ? (PHRASES[text] ?? text) : text;
}
