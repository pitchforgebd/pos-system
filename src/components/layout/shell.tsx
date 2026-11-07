"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { Header } from "@/components/layout/header";
import type { UiLang } from "@/lib/i18n/nav";
import { NavLinks } from "@/components/layout/nav-links";
import { Sidebar } from "@/components/layout/sidebar";
import { Drawer } from "@/components/ui/drawer";

export function AppShell({
  children,
  allowed,
  session,
  lang,
  logoUrl,
}: {
  children: ReactNode;
  allowed: readonly string[];
  lang: UiLang;
  logoUrl: string;
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
        Skip to content
      </a>
      <Sidebar
        allowed={allowed}
        collapsed={menuCollapsed}
        lang={lang}
        logoUrl={logoUrl}
        organizationName={session.organizationName}
        branchName={session.branches.find((item) => item.id === session.branchId)?.name ?? session.branches[0]?.name ?? "No branch"}
      />
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
      <Drawer open={menuOpen} onOpenChange={(open) => setMenuPath(open ? pathname : null)} title="Menu" side="left">
        <NavLinks allowed={allowed} lang={lang} onNavigate={() => setMenuPath(null)} variant="canvas" />
      </Drawer>
    </div>
  );
}
