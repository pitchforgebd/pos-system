/**
 * One area of the screens' text, in both languages (P13 task 1). The English text decides the keys; the Bangla text must have exactly the same keys, so a
 * key missing in Bangla (or one that is only in Bangla) is an error when the code is checked, not a blank in the page. A key is `area.name`, and a
 * `{name}` in the text is filled in by `t("area.key", { name: "..." })`.
 */
export type Area<E extends Record<string, string>> = { en: E; bn: Record<keyof E, string> };

export function area<const E extends Record<string, string>>(en: E, bn: Record<keyof E, string>): Area<E> {
  return { en, bn };
}
