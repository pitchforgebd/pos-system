import type { Metadata } from "next";

import { DashboardView } from "@/components/dashboard/dashboard-view";
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
  return new Date().toISOString().slice(0, 10);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; scope?: string }>;
}) {
  const params = await searchParams;
  const view = previewView(params.view);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "") ? params.date! : today();
  const session = view === "ready" ? await getSession() : null;
  const scope = params.scope === "all" || !session?.branchId ? "all" : "branch";
  const summary =
    session && view === "ready"
      ? await wingSummary(
          session.organizationId,
          scope === "all" ? null : session.branchId,
          session.branches.map((branch) => branch.id),
          day,
        )
      : emptySummary;

  return (
    <DashboardView
      view={view}
      day={day}
      scope={scope}
      branches={session?.branches ?? []}
      branchId={session?.branchId ?? null}
      summary={summary}
    />
  );
}
