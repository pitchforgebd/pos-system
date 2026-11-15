import type { ReactNode } from "react";
import Link from "next/link";

import { LanguageSwitch } from "@/components/layout/language-switch";
import { APP_NAME } from "@/constants/app";
import { I18nBoundary } from "@/lib/i18n/server";

// Sign-in pages are made for each request: a content security policy with a nonce needs it, and nothing here may be kept by a cache (LV-6).
export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <I18nBoundary areas={["auth"]}>
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
        <div className="w-full max-w-md space-y-6">
          <div className="flex items-center justify-between gap-3">
            <Link href="/dashboard" className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">M</span>
              <span className="text-sm font-semibold">{APP_NAME}</span>
            </Link>
            <LanguageSwitch />
          </div>
          <div className="rounded-md border border-border bg-surface p-5">{children}</div>
        </div>
      </div>
    </I18nBoundary>
  );
}
