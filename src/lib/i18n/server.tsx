import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { buildI18n, type I18n } from "@/lib/i18n/build";
import { DIGITS_COOKIE, digitsFrom, LANG_COOKIE, langFrom, type Fmt } from "@/lib/i18n/lang";
import { messagesFor, type AreaName } from "@/lib/i18n/messages";
import { translatePhrase } from "@/lib/i18n/phrases";
import { I18nProvider } from "@/lib/i18n/provider";

/** The language and the digits of this request, from the cookies. */
export async function getPrefs(): Promise<Fmt> {
  const jar = await cookies();
  return { lang: langFrom(jar.get(LANG_COOKIE)?.value), digits: digitsFrom(jar.get(DIGITS_COOKIE)?.value) };
}

/** For a server component: the texts of these areas (and the common ones) and the formats of this request. */
export async function getI18n(...names: AreaName[]): Promise<I18n> {
  const prefs = await getPrefs();
  return buildI18n(prefs, messagesFor(prefs.lang, names));
}

/** For a server component that writes English sentences directly: `const ph = await getPhrase();` then `ph("Sales")`. */
export async function getPhrase() {
  const { lang } = await getPrefs();
  return (text: string) => translatePhrase(lang, text);
}

/** Wraps client components so they can `useI18n()`; list the areas of text they use. */
export async function I18nBoundary({ areas = [], children }: { areas?: AreaName[]; children: ReactNode }) {
  const prefs = await getPrefs();
  return (
    <I18nProvider lang={prefs.lang} digits={prefs.digits} messages={messagesFor(prefs.lang, areas)}>
      {children}
    </I18nProvider>
  );
}
