import type { Lang } from "@/lib/i18n/lang";
import { auth } from "@/lib/i18n/messages/auth";
import { common } from "@/lib/i18n/messages/common";
import { customers } from "@/lib/i18n/messages/customers";
import { dashboard } from "@/lib/i18n/messages/dashboard";
import { errors } from "@/lib/i18n/messages/errors";
import { orders } from "@/lib/i18n/messages/orders";
import { pos } from "@/lib/i18n/messages/pos";
import { products } from "@/lib/i18n/messages/products";
import type { Area } from "@/lib/i18n/messages/define";
import { returns } from "@/lib/i18n/messages/returns";
import { sales } from "@/lib/i18n/messages/sales";
import { shell } from "@/lib/i18n/messages/shell";

// Every area of text. A new area is added here and nowhere else; the keys of all areas together are the type of `t`.

export const areas = { common, shell, auth, errors, dashboard, pos, customers, sales, returns, orders, products } as const;
export type AreaName = keyof typeof areas;
type KeysOf<A> = A extends Area<infer E> ? keyof E & string : never;
export type MessageKey = KeysOf<(typeof areas)[AreaName]>;

/** The texts of the named areas in one language, as a plain object (what a page sends to its client components). */
export function messagesFor(lang: Lang, names: readonly AreaName[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of new Set<AreaName>(["common", "shell", ...names])) {
    Object.assign(out, areas[name][lang]);
  }
  return out;
}
