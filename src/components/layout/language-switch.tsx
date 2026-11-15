"use client";

import { useSubmit } from "@/lib/client/use-submit";
import { useI18n } from "@/lib/i18n/provider";

/** Bangla / English for a page with no menu (sign-in): sets the language cookie and renders the page again. */
export function LanguageSwitch() {
  const { lang, t } = useI18n();
  const { submit, pending } = useSubmit();

  function choose(next: "bn" | "en") {
    if (next === lang || pending) {
      return;
    }
    void submit({ url: "/api/v1/locale", body: { lang: next } }, { quiet: true, refresh: true });
  }

  const style = (active: boolean) => `rounded-md px-2.5 py-1 text-sm ${active ? "bg-primary font-semibold text-primary-foreground" : "text-muted hover:bg-secondary"}`;
  return (
    <div className="flex items-center gap-1" role="group" aria-label={t("shell.language")}>
      <button type="button" className={style(lang === "bn")} aria-pressed={lang === "bn"} onClick={() => choose("bn")}>
        বাংলা
      </button>
      <button type="button" className={style(lang === "en")} aria-pressed={lang === "en"} onClick={() => choose("en")}>
        English
      </button>
    </div>
  );
}
