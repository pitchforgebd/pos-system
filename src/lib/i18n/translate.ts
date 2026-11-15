import { DEFAULT_LANG, type Lang } from "@/lib/i18n/lang";

export type Params = Record<string, string | number>;

/** Fills the `{name}` places of a text. A place with no value is left as it is, so the gap shows instead of vanishing. */
export function fill(text: string, params?: Params) {
  if (!params) {
    return text;
  }
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** The `t` of one language over the messages that were loaded; a key that was not loaded comes back as the key, which a test looks for. */
export function makeT<K extends string>(messages: Readonly<Record<string, string>>, lang: Lang = DEFAULT_LANG) {
  return (key: K, params?: Params) => {
    const text = messages[key];
    if (text === undefined) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[i18n] no ${lang} text for "${key}"`);
      }
      return key;
    }
    return fill(text, params);
  };
}
