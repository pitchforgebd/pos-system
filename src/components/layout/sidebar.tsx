import Link from "next/link";

import { NavLinks } from "@/components/layout/nav-links";
import type { UiLang } from "@/lib/i18n/nav";

export function Sidebar({
  allowed,
  collapsed = false,
  lang,
  logoUrl,
  organizationName,
  branchName,
}: {
  allowed: readonly string[];
  collapsed?: boolean;
  lang: UiLang;
  logoUrl: string;
  organizationName: string;
  branchName: string;
}) {
  return (
    <aside className={collapsed ? "hidden" : "fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-[#2b3142] text-sidebar-foreground lg:flex"}>
      <Link href="/dashboard" className="flex h-14 items-center gap-2 px-4 text-sm font-semibold tracking-tight">
        {logoUrl ? <img src={logoUrl} alt="" className="h-8 w-8 rounded object-contain" /> : null}
        <span className="truncate">{organizationName}</span>
      </Link>
      <p className="mx-3 mb-2 rounded-full border border-dashed border-white/35 px-3 py-1 text-center text-xs text-white/80">
        {branchName}
      </p>
      <div className="flex-1 overflow-y-auto pb-6">
        <NavLinks allowed={allowed} lang={lang} />
      </div>
    </aside>
  );
}
