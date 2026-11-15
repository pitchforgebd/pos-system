import type { Metadata } from "next";
import { businessDate, isIsoDate } from "@/core/time/business-date";

import Link from "next/link";

import { cookies } from "next/headers";
import { after } from "next/server";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { TodayBoard } from "@/components/reports/today-board";
import { dashboardFor } from "@/modules/reports/dashboard";
import { ensureSnapshots } from "@/modules/reports/snapshots";
import { depreciationReminder } from "@/modules/assets/assets";
import { companyWorth } from "@/modules/assets/worth";
import { getSession } from "@/modules/auth/current-session";
import { wingSummary, type WingSummary } from "@/modules/reports/wing-summary";

export const metadata: Metadata = {
  title: "Dashboard",
};

const emptySummary: WingSummary = {
  totalSales: "0.00",
  instantPaid: "0.00",
  totalDueSale: "0.00",
  dueReceived: "0.00",
  totalReturn: "0.00",
  totalExpense: "0.00",
  previousReturn: "0.00",
  stockAlertQty: "0",
  totalPayment: "0.00",
  dueReceivedAlert: "0",
  netProfit: "0.00",
  totalPurchases: "0.00",
  walletUsedBalance: "0.00",
  supplierAdvanceBalance: "0.00",
  customerAdvanceBalance: "0.00",
  weekSales: "0.00",
  weekDays: [],
  sell: {},
  products: {},
  suppliers: {},
  dealers: {},
};

function previewView(value: string | undefined): "ready" | "loading" | "error" | "denied" {
  if (value === "loading" || value === "error" || value === "denied") {
    return value;
  }
  return "ready";
}

function today() {
  return businessDate();
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; scope?: string }>;
}) {
  const params = await searchParams;
  const view = previewView(params.view);
  const day = params.date && isIsoDate(params.date) ? params.date : today();
  const session = view === "ready" ? await getSession() : null;
  const scope = params.scope === "all" || !session?.branchId ? "all" : "branch";
  const lang = (await cookies()).get("meridian_lang")?.value === "bn" ? "bn" : "en";
  // Today's cards come from the reports themselves (I16): the same figure is on the card and in its report.
  const canReports = Boolean(session && view === "ready" && session.permissions.has("reports.view"));
  const board =
    canReports && session
      ? await dashboardFor({ organizationId: session.organizationId, branchIds: scope === "all" || !session.branchId ? [...session.branchIds] : [session.branchId], canProfit: session.permissions.has("reports.profit") }, day)
      : null;
  // The first sign-in after midnight makes the days that are over snapshots (the cron job does the same): after the answer has gone, never in its way.
  if (session && view === "ready" && canReports) {
    const organizationId = session.organizationId;
    after(async () => {
      await ensureSnapshots(organizationId).catch(() => undefined);
    });
  }
  const legacy =
    session && view === "ready"
      ? await wingSummary(
          session.organizationId,
          scope === "all" ? null : session.branchId,
          session.branches.map((branch) => branch.id),
          day,
        )
      : emptySummary;
  const card = (key: string) => board?.cards.find((row) => row.key === key)?.value;
  const summary = board
    ? {
        ...legacy,
        totalSales: card("sales") ?? legacy.totalSales,
        instantPaid: card("paid") ?? legacy.instantPaid,
        totalDueSale: card("newDue") ?? legacy.totalDueSale,
        dueReceived: card("dueCollected") ?? legacy.dueReceived,
        totalExpense: card("expenses") ?? legacy.totalExpense,
        ...(card("profit") ? { netProfit: card("profit") as string } : {}),
        stockAlertQty: card("lowStock") ?? legacy.stockAlertQty,
        products: { ...legacy.products, cashInHand: card("cash") ?? legacy.products.cashInHand, cashAtBank: card("bank") ?? legacy.products.cashAtBank, ...(card("stockValue") ? { stockValue: card("stockValue") as string } : {}) },
        sell: { ...legacy.sell, customersDue: card("customersOwe") ?? legacy.sell.customersDue, salesDue: card("customersOwe") ?? legacy.sell.salesDue },
        suppliers: { ...legacy.suppliers, suppliersDue: card("vendorsOwed") ?? legacy.suppliers.suppliersDue },
      }
    : legacy;

  // The company's worth and the month-end depreciation reminder (P09), for those who see the books.
  const books = session && view === "ready" && session.permissions.has("accounting.view");
  const [worth, reminder] = books ? await Promise.all([companyWorth(session.organizationId), depreciationReminder(session.organizationId)]) : [null, null];

  return (
    <>
      {board ? <TodayBoard board={board} lang={lang} /> : null}
      {worth || reminder ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          {worth ? (
            <Link href="/accounting/worth" className="rounded-xl bg-[#0f8f78] px-4 py-3 text-white">
              <span className="text-xs font-semibold tracking-wide">COMPANY WORTH</span>
              <span className="mt-1 block text-2xl font-semibold">{worth.net}</span>
              <span className="text-xs">{`Owns ${worth.assets} · owes ${worth.liabilities}`}</span>
            </Link>
          ) : null}
          {reminder ? (
            <Link href={`/accounting/depreciation?month=${reminder.month}`} className="rounded-xl border border-warning/40 bg-warning-subtle px-4 py-3 text-sm">
              <span className="font-semibold">{`Depreciation for ${reminder.month} is not posted`}</span>
              <span className="mt-1 block">{`${reminder.assets} asset${reminder.assets === 1 ? "" : "s"}, ${reminder.total}. Post it now.`}</span>
            </Link>
          ) : null}
        </div>
      ) : null}
      <DashboardView
        view={view}
        day={day}
        scope={scope}
        branches={session?.branches ?? []}
        branchId={session?.branchId ?? null}
        summary={summary}
      />
    </>
  );
}
