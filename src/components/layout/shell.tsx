"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { Header } from "@/components/layout/header";
import type { UiLang } from "@/lib/i18n/nav";
import { NavLinks } from "@/components/layout/nav-links";
import { Drawer } from "@/components/ui/drawer";
import { useI18n } from "@/lib/i18n/provider";

/**
 * The frame. The sidebar is made by the layout (on the server, where its text and links are plain markup) and handed in as `sidebar`; only what
 * needs state (the menu being open or closed, the header's search) is a client component (U3).
 */
export function AppShell({
  children,
  sidebar,
  allowed,
  badges,
  session,
  lang,
}: {
  children: ReactNode;
  sidebar: ReactNode;
  allowed: readonly string[];
  badges?: Record<string, number>;
  lang: UiLang;
  session: {
    name: string;
    organizationName: string;
    branches: { id: string; name: string }[];
    branchId: string | null;
  };
}) {
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [pinnedClosed, setPinnedClosed] = useState(false);
  // The sell-page menu stays open only for the path where it was opened, so a route change closes it.
  const [sellMenuPath, setSellMenuPath] = useState<string | null>(null);
  const pathname = usePathname();
  const { t } = useI18n();
  const menuOpen = menuPath === pathname;
  const sellPage = pathname === "/pos" || pathname === "/sales/new";
  const sellMenuOpen = sellMenuPath === pathname;
  const menuCollapsed = sellPage ? !sellMenuOpen : pinnedClosed;

  function toggleMenu() {
    if (sellPage) {
      setSellMenuPath(sellMenuOpen ? null : pathname);
      return;
    }
    setPinnedClosed((closed) => !closed);
  }

  return (
    <div className="min-h-screen bg-background text-text">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-surface focus:px-3 focus:py-2"
      >
        {t("shell.skip")}
      </a>
      <div className={menuCollapsed ? "hidden" : "contents"}>{sidebar}</div>
      <div className={menuCollapsed ? "" : "lg:pl-64"}>
        <Header
          lang={lang}
          menuCollapsed={menuCollapsed}
          session={session}
          onOpenMenu={() => setMenuPath(pathname)}
          onToggleMenu={toggleMenu}
        />
        <main id="main" className="px-3 py-4 sm:px-4">
          {children}
        </main>
      </div>
      <Drawer open={menuOpen} onOpenChange={(open) => setMenuPath(open ? pathname : null)} title={t("shell.menu")} side="left">
        <NavLinks allowed={allowed} lang={lang} badges={badges} onNavigate={() => setMenuPath(null)} variant="canvas" />
      </Drawer>
    </div>
  );
}
