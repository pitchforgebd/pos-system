import Link from "next/link";

import { translateNav } from "@/lib/i18n/nav";
import { getPrefs } from "@/lib/i18n/server";

export async function Breadcrumb({
  items,
}: {
  items: { label: string; href?: string }[];
}) {
  const { lang } = await getPrefs();
  return (
    <nav aria-label={lang === "bn" ? "পথ" : "Breadcrumb"}>
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {index > 0 ? <span aria-hidden="true">/</span> : null}
              {item.href && !last ? (
                <Link href={item.href} className="hover:text-text">
                  {translateNav(lang, item.label)}
                </Link>
              ) : (
                <span className={last ? "text-text" : undefined} aria-current={last ? "page" : undefined}>
                  {translateNav(lang, item.label)}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
