import type { AreaName, MessageKey } from "@/lib/i18n/messages";
import { getI18n } from "@/lib/i18n/server";

/**
 * The title of the browser tab of a page, in the person's language: `export const generateMetadata = titled("sales", "sales.listTitle");`.
 * The area is loaded here, so the key is found (a key whose area is not loaded would come back as the key itself).
 */
export function titled(area: AreaName, key: MessageKey) {
  return async () => ({ title: (await getI18n(area)).t(key) });
}
