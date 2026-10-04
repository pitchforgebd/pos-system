"use client";

import { ChevronDown, Menu, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { APP_NAME } from "@/constants/app";
import { translateNav, type UiLang } from "@/lib/i18n/nav";
import { searchReferenceNav } from "@/constants/reference-nav";
import { SEARCH_DEBOUNCE_MS } from "@/constants/ui";
import { IconButton } from "@/components/ui/icon-button";
import { Menu as Dropdown, MenuItem, MenuLabel } from "@/components/ui/dropdown-menu";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

export function Header({
  onOpenMenu,
  onToggleMenu,
  menuCollapsed,
  session,
  lang,
}: {
  onOpenMenu: () => void;
  onToggleMenu: () => void;
  menuCollapsed: boolean;
  lang: UiLang;
  session: { name: string; branches: { id: string; name: string }[]; branchId: string | null };
}) {
  const current = session.branches.find((item) => item.id === session.branchId) ?? session.branches[0];
  const [branchName, setBranchName] = useState(current?.name ?? "No branch");
  const [query, setQuery] = useState("");
  const [clock, setClock] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const matches = useMemo(() => searchReferenceNav(debouncedQuery), [debouncedQuery]);

  function chooseLanguage(next: UiLang) {
    void fetch("/api/v1/locale", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lang: next }),
    }).then(() => window.location.reload());
  }

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-GB", { hour12: false }));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function selectBranch(branchId: string) {
    void fetch("/api/v1/session/branch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ branchId }),
    }).then((response) => {
      if (response.ok) {
        const next = session.branches.find((item) => item.id === branchId);
        setBranchName(next?.name ?? branchName);
        window.location.reload();
      }
    });
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-surface px-3">
      <IconButton label="Open menu" className="lg:hidden" onClick={onOpenMenu}>
        <Menu className="size-4" aria-hidden="true" />
      </IconButton>
      <IconButton label={menuCollapsed ? "Show menu" : "Hide menu"} className="hidden lg:inline-flex" onClick={onToggleMenu}>
        {menuCollapsed ? <PanelLeftOpen className="size-4" aria-hidden="true" /> : <PanelLeftClose className="size-4" aria-hidden="true" />}
      </IconButton>
      <Link href="/dashboard" className="text-sm font-semibold lg:hidden">
        {APP_NAME}
      </Link>
      <Link href="/dashboard" className="hidden h-8 items-center rounded-md bg-[#e25b2a] px-3 text-xs font-semibold text-white sm:inline-flex">
        Wings
      </Link>
      <Link href="/accounting/bank-cash" className="hidden h-8 items-center rounded-md bg-[#2f6fed] px-3 text-xs font-semibold text-white sm:inline-flex">
        Balance
      </Link>
      <Link href="/pos" className="hidden h-8 items-center rounded-md bg-[#1f9d55] px-3 text-xs font-semibold text-white sm:inline-flex">
        Sell
      </Link>
      <div className="relative ml-auto hidden min-w-0 md:block md:w-72">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/80" aria-hidden="true" />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search anything..."
          aria-label="Search screens"
          className="h-9 w-full rounded-full bg-[#7c4dff] pr-16 pl-9 text-sm text-white outline-none placeholder:text-white/80"
        />
        <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded bg-white/20 px-1.5 py-0.5 text-[10px] text-white">
          Ctrl K
        </span>
        {debouncedQuery.trim().length >= 2 ? (
          <div className="absolute top-11 z-30 w-full rounded-md border border-border bg-surface p-2 text-text shadow-[0_8px_24px_rgba(15,39,68,0.12)]">
            {matches.length === 0 ? (
              <p className="px-2 py-2 text-sm text-muted">No matching screen</p>
            ) : (
              <ul>
                {matches.map((item) => (
                  <li key={`${item.href}-${item.label}`}>
                    <Link href={item.href} className="block rounded-md px-2 py-2 text-sm hover:bg-secondary" onClick={() => setQuery("")}>
                      {translateNav(lang, item.label)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
      <span className="hidden font-mono text-sm text-muted xl:inline" suppressHydrationWarning>
        {clock}
      </span>
      <Link href="/pos/open-tickets" className="hidden h-8 items-center rounded-md bg-[#7c4dff] px-3 text-xs font-semibold text-white md:inline-flex">
        Open Ticket
      </Link>
      <Dropdown
        label={translateNav(lang, "Language")}
        trigger={
          <button type="button" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm hover:bg-secondary">
            {lang === "bn" ? "বাংলা" : "English"}
            <ChevronDown className="size-3.5 text-muted" aria-hidden="true" />
          </button>
        }
      >
        <MenuItem onSelect={() => chooseLanguage("en")}>English</MenuItem>
        <MenuItem onSelect={() => chooseLanguage("bn")}>বাংলা</MenuItem>
      </Dropdown>
      <Dropdown
        label="Account"
        trigger={
          <button type="button" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm hover:bg-secondary">
            <span className="max-w-28 truncate">{session.name}</span>
            <ChevronDown className="size-3.5 text-muted" aria-hidden="true" />
          </button>
        }
      >
        <MenuLabel>{branchName}</MenuLabel>
        {session.branches.map((item) => (
          <MenuItem key={item.id} onSelect={() => selectBranch(item.id)}>
            {item.name}
          </MenuItem>
        ))}
        <MenuItem
          onSelect={() => {
            void fetch("/api/v1/auth/logout", { method: "POST" }).then(() => {
              window.location.replace("/login");
            });
          }}
        >
          Log Out
        </MenuItem>
      </Dropdown>
    </header>
  );
}
