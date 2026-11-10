"use client";

import {
  Bell,
  Boxes,
  Building2,
  ChevronDown,
  ClipboardList,
  FileText,
  Landmark,
  LayoutDashboard,
  MessageSquare,
  Package,
  RotateCcw,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Ticket,
  Timer,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { referenceNavigation, type ReferenceChild, type ReferenceEntry } from "@/constants/reference-nav";
import { translateNav, type UiLang } from "@/lib/i18n/nav";
import { cn } from "@/lib/utils";

const icons: Record<string, LucideIcon> = {
  "Open Ticket": Ticket,
  "Shift Management": Timer,
  "Main Wing Dashboard": LayoutDashboard,
  "Shop Setting and Others": Settings,
  "Shop Branch": Building2,
  Products: Boxes,
  "Opening & Own Stock": Warehouse,
  "Product Stocks": Package,
  "Product Summary": ClipboardList,
  "Stock Alert Quantity": Bell,
  "Product Transfer": Truck,
  "Product Ledger Table": FileText,
  "Damage Products": Package,
  "SMS Panel": MessageSquare,
  Customers: Users,
  "Take Customer Due": Landmark,
  "Customer Advance": Landmark,
  Sell: ShoppingCart,
  "Sold Invoices(New)": ShoppingBag,
  Warranty: FileText,
  "Return & Refunds": RotateCcw,
  Requisition: ClipboardList,
  Quotation: FileText,
  Purchases: Package,
  Supplier: Truck,
  "Accounts & Reports": Landmark,
  Users: Users,
  "Audit logs": FileText,
};

function allowedChild(child: ReferenceChild, allowed: ReadonlySet<string>) {
  return child.href ? allowed.has(child.href) : true;
}

function entryVisible(entry: ReferenceEntry, allowed: ReadonlySet<string>) {
  if (entry.kind === "label") {
    return true;
  }
  if (entry.kind === "link") {
    return entry.href ? allowed.has(entry.href) : true;
  }
  return entry.children.some((child) => allowedChild(child, allowed));
}

export function NavLinks({
  onNavigate,
  variant = "sidebar",
  allowed,
  lang = "en",
  badges,
}: {
  onNavigate?: () => void;
  variant?: "sidebar" | "canvas";
  allowed?: readonly string[];
  lang?: UiLang;
  /** A count shown beside a link (by its href), for example the low-stock rows beside Stock Alert Quantity. */
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();
  const granted = new Set(allowed ?? []);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const dark = variant === "sidebar";

  function active(href: string | undefined) {
    return Boolean(href) && (pathname === href || pathname.startsWith(`${href}/`));
  }

  function row(label: string, href: string | undefined, nested = false) {
    const className = cn(
      "flex h-9 items-center gap-2 rounded-md px-2 text-[13px]",
      nested && "pl-8",
      dark ? "text-sidebar-foreground hover:bg-white/10" : "text-text hover:bg-secondary",
      active(href) && (dark ? "bg-white/10 font-medium" : "bg-secondary font-medium"),
      !href && "cursor-default opacity-50 hover:bg-transparent",
    );
    const body = (
      <>
        {!nested ? <Icon label={label} /> : <span className="size-1.5 rounded-full bg-current opacity-60" aria-hidden="true" />}
        <span className="truncate">{translateNav(lang, label)}</span>
        {href && badges?.[href] ? (
          <span className="ml-auto rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white" title="Needs attention">
            {badges[href]}
          </span>
        ) : null}
      </>
    );
    if (!href) {
      return <span className={className}>{body}</span>;
    }
    return (
      <Link href={href} aria-current={active(href) ? "page" : undefined} onClick={onNavigate} className={className}>
        {body}
      </Link>
    );
  }

  return (
    <nav aria-label="Primary" className="space-y-1 px-2 py-3">
      {referenceNavigation.filter((entry) => entryVisible(entry, granted)).map((entry) => {
        if (entry.kind === "label") {
          return (
            <p key={entry.label} className={cn("px-2 pt-4 pb-1 text-[11px] font-semibold tracking-wide", dark ? "text-sidebar-muted" : "text-muted")}>
              {translateNav(lang, entry.label)}
            </p>
          );
        }
        if (entry.kind === "link") {
          return (
            <div key={entry.label} className="py-0.5">
              {row(entry.label, entry.href)}
            </div>
          );
        }
        const children = entry.children.filter((child) => allowedChild(child, granted));
        const contains = children.some((child) => active(child.href));
        const expanded = open[entry.label] ?? contains;
        return (
          <div key={entry.label} className="py-0.5">
            <button
              type="button"
              className={cn(
                "flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]",
                dark ? "text-sidebar-foreground hover:bg-white/10" : "text-text hover:bg-secondary",
              )}
              aria-expanded={expanded}
              onClick={() => setOpen((current) => ({ ...current, [entry.label]: !expanded }))}
            >
              <Icon label={entry.label} />
              <span className="truncate">{translateNav(lang, entry.label)}</span>
              <ChevronDown className={cn("ml-auto size-3.5 shrink-0 opacity-70", expanded && "rotate-180")} aria-hidden="true" />
            </button>
            {expanded ? (
              <ul className="mt-0.5 space-y-0.5">
                {children.map((child) => (
                  <li key={`${entry.label}-${child.label}`}>{row(child.label, child.href, true)}</li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

function Icon({ label }: { label: string }) {
  const Glyph = icons[label] ?? LayoutDashboard;
  return <Glyph className="size-4 shrink-0 opacity-80" aria-hidden="true" />;
}
