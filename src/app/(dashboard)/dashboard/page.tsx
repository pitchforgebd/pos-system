import type { Metadata } from "next";
import { after } from "next/server";

import { Today } from "@/components/dashboard/today";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, PermissionDenied } from "@/components/ui/states";
import { businessDate, isIsoDate } from "@/core/time/business-date";
import { getI18n, I18nBoundary } from "@/lib/i18n/server";
import { depreciationReminder } from "@/modules/assets/assets";
import { companyWorth } from "@/modules/assets/worth";
import { getSession } from "@/modules/auth/current-session";
import { dashboardFor } from "@/modules/reports/dashboard";
import { ensureSnapshots } from "@/modules/reports/snapshots";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n("dashboard")).t("dashboard.title") };
}

type View = "ready" | "loading" | "error" | "denied";

function previewView(value: string | undefined): View {
  return value === "loading" || value === "error" || value === "denied" ? value : "ready";
}

/** The hour in Dhaka, for the greeting. */
const dhakaHour = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", hourCycle: "h23" }).format(new Date()));

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string; scope?: string }> }) {
  const params = await searchParams;
  const view = previewView(params.view);
  const { t } = await getI18n("dashboard");

  // The loading, error and denied looks can be opened on purpose (?view=loading) to check them.
  if (view === "loading") {
    return (
      <div className="space-y-4" aria-busy="true" aria-live="polite">
        <Skeleton className="h-20 w-full" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (view === "error") {
    return <ErrorState title={t("dashboard.errorTitle")} description={t("dashboard.errorBody")} />;
  }
  if (view === "denied") {
    return <PermissionDenied title={t("dashboard.deniedTitle")} description={t("dashboard.deniedBody")} />;
  }

  const session = await getSession();
  if (!session) {
    return <PermissionDenied title={t("dashboard.deniedTitle")} description={t("dashboard.deniedBody")} />;
  }
  const day = params.date && isIsoDate(params.date) ? params.date : businessDate();
  const scope = params.scope === "all" || !session.branchId ? "all" : "branch";
  const can = (code: string) => session.permissions.has(code);
  const canReports = can("reports.view");
  const branchIds = scope === "all" || !session.branchId ? [...session.branchIds] : [session.branchId];

  // Today's cards come from the reports themselves (I16): the same figure is on the card and in its report.
  const board = canReports ? await dashboardFor({ organizationId: session.organizationId, branchIds, canProfit: can("reports.profit") }, day) : null;
  if (canReports) {
    const organizationId = session.organizationId;
    // The first sign-in after midnight makes the days that are over snapshots (the cron job does the same): after the answer has gone, never in its way.
    after(async () => {
      await ensureSnapshots(organizationId).catch(() => undefined);
    });
  }

  // The company's worth and the month-end depreciation reminder (P09), for those who see the books.
  const books = can("accounting.view");
  const [worth, reminder] = books ? await Promise.all([companyWorth(session.organizationId), depreciationReminder(session.organizationId)]) : [null, null];
  const branchName = session.branches.find((branch) => branch.id === session.branchId)?.name ?? session.branches[0]?.name ?? "";

  return (
    <I18nBoundary areas={["dashboard"]}>
      <Today
        board={board}
        name={session.name}
        branchName={branchName}
        day={day}
        scope={scope}
        branches={session.branches}
        branchId={session.branchId}
        can={{
          sale: can("sales.create"),
          order: can("orders.create"),
          payment: can("customers.payment"),
          purchase: can("purchase.create"),
          expense: can("accounting.create"),
          product: can("products.create"),
          customer: can("customers.create"),
          reports: canReports,
          books,
          profit: can("reports.profit"),
        }}
        worth={worth ? { net: worth.net, assets: worth.assets, liabilities: worth.liabilities } : null}
        reminder={reminder ? { month: reminder.month, assets: reminder.assets, total: reminder.total } : null}
        hour={dhakaHour()}
      />
    </I18nBoundary>
  );
}
