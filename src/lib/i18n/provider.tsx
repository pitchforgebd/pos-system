"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { buildI18n, type I18n } from "@/lib/i18n/build";
import type { Digits, Lang } from "@/lib/i18n/lang";

const Context = createContext<I18n | null>(null);

/** Gives the client components below it the language, the digits and the texts the server picked for this page. */
export function I18nProvider({ lang, digits, messages, children }: { lang: Lang; digits: Digits; messages: Record<string, string>; children: ReactNode }) {
  const value = useMemo(() => buildI18n({ lang, digits }, messages), [lang, digits, messages]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(Context);
  if (!value) {
    throw new Error("useI18n needs an I18nProvider above it (the layout or the page puts one there)");
  }
  return value;
}
