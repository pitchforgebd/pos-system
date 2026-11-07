"use client";

import {
  BadgeDollarSign,
  Banknote,
  Boxes,
  CircleDollarSign,
  HandCoins,
  Package,
  Receipt,
  RotateCcw,
  ShoppingCart,
  Truck,
  Undo2,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { WingSummary } from "@/modules/reports/wing-summary";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, PermissionDenied } from "@/components/ui/states";

const tones = [
  "from-[#c026d3] to-[#7a1f7a]",
  "from-[#8b5cf6] to-[#4c1d95]",
  "from-[#fb923c] to-[#c2410c]",
  "from-[#2dd4bf] to-[#0f766e]",
  "from-[#f97316] to-[#c2410c]",
  "from-[#60a5fa] to-[#1d4ed8]",
  "from-[#f59e0b] to-[#b45309]",
  "from-[#3b82f6] to-[#1e3a8a]",
  "from-[#84cc16] to-[#3f6212]",
  "from-[#14b8a6] to-[#0f766e]",
  "from-[#22c55e] to-[#166534]",
  "from-[#a855f7] to-[#6b21a8]",
  "from-[#6366f1] to-[#312e81]",
  "from-[#f59e0b] to-[#b45309]",
  "from-[#34d399] to-[#047857]",
];

function grouped(value: string) {
  if (!value.includes(".")) {
    return value;
  }
  const [whole, frac] = value.split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = whole.replace("-", "");
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

export function DashboardView({
  view,
  day,
  scope,
  branches,
  branchId,
  summary,
}: {
  view: "ready" | "loading" | "error" | "denied";
  day: string;
  scope: "branch" | "all";
  branches: { id: string; name: string }[];
  branchId: string | null;
  summary: WingSummary;
}) {
  const router = useRouter();
  const [weekOpen, setWeekOpen] = useState(true);

  if (view === "loading") {
    return (
      <div className="space-y-4" aria-busy="true" aria-live="polite">
        <Skeleton className="h-16 w-full" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {tones.map((tone, index) => (
            <Skeleton key={`${tone}-${index}`} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  if (view === "error") {
    return (
      <ErrorState
        title="Dashboard unavailable"
        description="The daily summary could not be shown. Nothing was changed."
        onRetry={() => router.push("/dashboard")}
      />
    );
  }

  if (view === "denied") {
    return <PermissionDenied title="Dashboard access required" description="Your account cannot open the dashboard." />;
  }

  const cards: { label: string; value: string; href: string; icon: LucideIcon }[] = [
    { label: "TOTAL SALES", value: grouped(summary.totalSales), href: "/reports/sales", icon: ShoppingCart },
    { label: "INSTANT PAID", value: grouped(summary.instantPaid), href: "/reports/cash", icon: Banknote },
    { label: "TOTAL DUE SALE", value: grouped(summary.totalDueSale), href: "/sales", icon: Receipt },
    { label: "DUE RECEIVED", value: grouped(summary.dueReceived), href: "/customers/payments", icon: HandCoins },
    { label: "TOTAL RETURN", value: grouped(summary.totalReturn), href: "/sales/returns", icon: RotateCcw },
    { label: "TOTAL EXPENSE", value: grouped(summary.totalExpense), href: "/accounting/expenses", icon: CircleDollarSign },
    { label: "PREVIOUS RETURN", value: grouped(summary.previousReturn), href: "/sales/returns", icon: Undo2 },
    { label: "STOCK ALERT QTY", value: summary.stockAlertQty, href: "/inventory/alerts", icon: Boxes },
    { label: "TOTAL PAYMENT", value: grouped(summary.totalPayment), href: "/suppliers/payments", icon: BadgeDollarSign },
    { label: "DUE RECEIVED ALERT", value: summary.dueReceivedAlert, href: "/customers/installments", icon: Receipt },
    { label: "NET PROFIT", value: grouped(summary.netProfit), href: "/reports/profit-loss", icon: CircleDollarSign },
    { label: "TOTAL PURCHASES", value: grouped(summary.totalPurchases), href: "/reports/purchases", icon: Package },
    { label: "WALLET USED BALANCE", value: grouped(summary.walletUsedBalance), href: "/accounting", icon: Wallet },
    { label: "SUPPLIER ADVANCE BALANCE", value: grouped(summary.supplierAdvanceBalance), href: "/suppliers", icon: Truck },
    { label: "CUSTOMER ADVANCE BALANCE", value: grouped(summary.customerAdvanceBalance), href: "/customers/advances", icon: HandCoins },
  ];

  function openDay(nextDay: string, nextScope: "branch" | "all") {
    const params = new URLSearchParams({ date: nextDay });
    if (nextScope === "all") {
      params.set("scope", "all");
    }
    router.push(`/dashboard?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <h1 className="border-l-4 border-[#7c4dff] pl-3 text-lg font-semibold">Daily Sales & Return Summary</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="min-w-56 flex-1 text-sm">
            <span className="sr-only">Branch</span>
            <select
              className="h-10 w-full rounded-md border border-border bg-surface px-3"
              value={scope === "all" ? "all" : (branchId ?? "")}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "all") {
                  openDay(day, "all");
                  return;
                }
                void fetch("/api/v1/session/branch", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ branchId: value }),
                }).then((response) => {
                  if (response.ok) {
                    router.push(`/dashboard?date=${day}`);
                    // The header and layout read the session branch, so reload their server data too.
                    router.refresh();
                  }
                });
              }}
            >
              <option value="all">All Branch</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="sr-only">Date</span>
            <input
              type="date"
              value={day}
              className="h-10 rounded-md border border-border bg-surface px-3"
              onChange={(event) => {
                if (event.target.value) {
                  openDay(event.target.value, scope);
                }
              }}
            />
          </label>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card, index) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.label}
                href={card.href}
                className={`relative overflow-hidden rounded-xl bg-gradient-to-br px-4 py-5 text-white shadow-sm ${tones[index]}`}
              >
                <span className="flex items-center gap-2 text-xs font-semibold tracking-wide">
                  <Icon className="size-4" aria-hidden="true" />
                  {card.label}
                </span>
                <span className="mt-3 block text-2xl font-semibold">{card.value}</span>
                <span className="pointer-events-none absolute -right-3 -bottom-6 size-24 rounded-full bg-white/10" />
              </Link>
            );
          })}
        </div>
      </section>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <div className="flex justify-center">
            <Link href="/reports" className="rounded-md bg-[#2f6fed] px-4 py-2 text-sm font-semibold text-white">
              Generate All Report
            </Link>
          </div>
          <Board
            title="Sell & Customers"
            action="Generate Sell Report"
            href="/reports/sales"
            tone="text-[#5b4bdb]"
            tiles={[
              ["TOTAL SALES", summary.sell.totalSales, "/reports/sales", "bg-[#f43f5e]"],
              ["TOTAL COLLECTIONS", summary.sell.totalCollections, "/reports/cash", "bg-[#f59e0b]"],
              ["SALES DUE", summary.sell.salesDue, "/reports/due-sales", "bg-[#fb7185]"],
              ["CURRENT MONTH SALES", summary.sell.monthSales, "/reports/sales", "bg-[#fb7185]"],
              ["CURRENT YEAR SALES", summary.sell.yearSales, "/reports/sales", "bg-[#f59e0b]"],
              ["TOTAL RETURN", summary.sell.totalReturn, "/sales/returns", "bg-[#60a5fa]"],
              ["CURRENT MONTH RETURN", summary.sell.monthReturn, "/sales/returns", "bg-[#fb923c]"],
              ["CURRENT YEAR RETURN", summary.sell.yearReturn, "/sales/returns", "bg-[#fb7185]"],
              ["TOTAL CUSTOMERS", summary.sell.totalCustomers, "/customers", "bg-[#60a5fa]"],
              ["DUE CUSTOMERS", summary.sell.dueCustomers, "/reports/customers", "bg-[#34d399]"],
              ["CUSTOMERS DUE", summary.sell.customersDue, "/reports/customers", "bg-[#fbbf24]"],
              ["OPENING DUE BALANCE", summary.sell.openingDue, "/reports/customers", "bg-[#fbbf24]"],
            ]}
          />
          <Board
            title="Products & Balance"
            action="Generate Products Report"
            href="/reports/inventory"
            tone="text-[#14804a]"
            tiles={[
              ["TOTAL PRODUCTS", summary.products.totalProducts, "/products", "bg-[#34d399]"],
              ["GODOWN PRODUCTS", summary.products.godownProducts, "/inventory/stock", "bg-[#34d399]"],
              ["G STOCK VALUE", summary.products.stockValue, "/reports/inventory", "bg-[#fbbf24]"],
              ["OPENING STOCK VALUE", summary.products.openingStockValue, "/inventory/opening-stock", "bg-[#34d399]"],
              ["CASH IN HAND", summary.products.cashInHand, "/reports/cash", "bg-[#fbbf24]"],
              ["CASH AT BANK", summary.products.cashAtBank, "/reports/bank", "bg-[#fbbf24]"],
            ]}
          />
          <Board
            title="Suppliers"
            action="Generate Supplier Report"
            href="/reports/suppliers"
            tone="text-[#7c3aed]"
            tiles={[
              ["TOTAL SUPPLIERS", summary.suppliers.totalSuppliers, "/suppliers", "bg-[#a78bfa]"],
              ["DUE SUPPLIERS", summary.suppliers.dueSuppliers, "/reports/suppliers", "bg-[#c4b5fd]"],
              ["SUPPLIERS DUE", summary.suppliers.suppliersDue, "/reports/suppliers", "bg-[#fbbf24]"],
            ]}
          />
          <Board
            title="Dealers"
            action="Generate Dealer Report"
            href="/customers/dealers"
            tone="text-[#14804a]"
            tiles={[
              ["TOTAL DEALERS", summary.dealers.totalDealers, "/customers/dealers", "bg-[#34d399]"],
              ["DUE DEALERS", summary.dealers.dueDealers, "/customers/dealers", "bg-[#6ee7b7]"],
              ["DEALERS DUE", summary.dealers.dealersDue, "/customers/dealers", "bg-[#fbbf24]"],
            ]}
          />
        </div>
        {weekOpen ? (
          <section>
            <p className="mb-2 text-right text-sm font-medium text-foreground">Last Seven Days Report</p>
            <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="relative bg-[#111827] px-4 py-5 text-white">
              <button type="button" className="absolute top-3 right-3 rounded bg-[#2f6fed] px-2 py-1 text-xs font-semibold text-white" onClick={() => setWeekOpen(false)}>
                Hide
              </button>
              <p className="text-lg font-semibold">Total Sales Amount</p>
              <p className="text-sm text-white/70">Last 7 Days</p>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {summary.weekDays.map((row) => (
                  <tr key={row.date} className="border-t border-border">
                    <td className="px-4 py-2">{row.date}</td>
                    <td className="px-4 py-2 text-right">{grouped(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </section>
        ) : (
          <button type="button" className="h-fit rounded-md bg-[#111827] px-3 py-2 text-sm text-white" onClick={() => setWeekOpen(true)}>
            Show last seven days
          </button>
        )}
      </div>
    </div>
  );
}

function Board({
  title,
  action,
  href,
  tone,
  tiles,
}: {
  title: string;
  action: string;
  href: string;
  tone: string;
  tiles: [string, string | undefined, string, string][];
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className={`text-sm font-semibold ${tone}`}>{title}</h2>
        <Link href={href} className="rounded-md bg-[#2f6fed] px-3 py-1.5 text-xs font-semibold text-white">
          {action}
        </Link>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map(([label, value, tileHref, color]) => (
          <Mini key={label} label={label} value={grouped(value ?? "0.00")} href={tileHref} color={color} />
        ))}
      </div>
    </section>
  );
}

function Mini({ label, value, href, color }: { label: string; value: string; href: string; color: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl border border-border bg-white px-3 py-3 hover:bg-surface-muted">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg text-white ${color}`} aria-hidden="true">
        <Receipt className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] text-muted">click button to generate report</span>
        <span className="block truncate text-[11px] font-semibold tracking-wide text-muted">{label}</span>
        <span className="block text-lg font-semibold">{value}</span>
      </span>
    </Link>
  );
}
