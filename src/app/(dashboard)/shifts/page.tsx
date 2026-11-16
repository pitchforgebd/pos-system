import Link from "next/link";
import { redirect } from "next/navigation";

import { OpenShiftForm } from "@/components/shifts/forms";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { activeShiftOf, listShifts, shiftRequired } from "@/modules/shifts/shifts";
import { moneyPickerOptions } from "@/modules/treasury/dashboard";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Shifts");

const views = ["active", "close", "history"] as const;

export default async function ShiftsPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const params = await searchParams;
  const view = views.find((item) => item === params.view) ?? "active";
  const q = params.q?.trim().toLowerCase() ?? "";
  const shifts = (await listShifts(session.organizationId, session.branchId)).filter((row) => {
    if (view === "active" && (row.userId !== session.userId || (row.status !== "OPEN" && row.status !== "ACTIVE"))) {
      return false;
    }
    if (view === "close" && (row.userId !== session.userId || row.status !== "CLOSING")) {
      return false;
    }
    if (!q) {
      return true;
    }
    return row.cashierName.toLowerCase().includes(q);
  });
  const title = view === "close" ? "Close My Shift" : view === "history" ? "Shift History" : "My Active Shift";
  const [mine, cashAccounts, required] = await Promise.all([activeShiftOf(session.organizationId, session.branchId, session.userId), moneyPickerOptions(session.organizationId), shiftRequired(session.organizationId)]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph(title)}
        description={ph("Open a shift with the cash in the drawer, work, then count and close. The drawer should hold the opening cash plus what this shift took in cash, less what it paid out. Two cashiers can work at the same time: each has a drawer of their own.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: ph("Shifts") }]}
      />
      {required && !mine ? <p className="rounded-md border border-border p-3 text-sm">{ph("This shop needs an open shift to take or pay cash. Open one to start.")}</p> : null}
      {mine && view === "active" ? (
        <p className="text-sm">
          {ph("You have a shift open.")} <Link href={`/shifts/${mine.id}`}>{ph("Open it")}</Link> {ph("to move cash, count the drawer and close.")}
        </p>
      ) : null}
      {session.permissions.has("shifts.manage") && view === "active" && !mine ? <OpenShiftForm cashAccounts={cashAccounts.filter((account) => account.kind === "CASH").map((account) => ({ id: account.id, label: account.label }))} /> : null}
      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/shifts?view=active" className={view === "active" ? "font-semibold" : "text-muted"}>
          {ph("My Active Shift")}
        </Link>
        <Link href="/shifts?view=close" className={view === "close" ? "font-semibold" : "text-muted"}>
          {ph("Close My Shift")}
        </Link>
        <Link href="/shifts?view=history" className={view === "history" ? "font-semibold" : "text-muted"}>
          {ph("Shift History")}
        </Link>
        <Link href="/accounting/statements" className="text-muted">
          {ph("Branch Ledger")}
        </Link>
      </div>
      <form className="flex flex-wrap items-end gap-2" action="/shifts">
        <input type="hidden" name="view" value={view} />
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          {ph("Search")}
          <input name="q" defaultValue={params.q ?? ""} placeholder={ph("Cashier")} className="h-10 rounded-md border border-border px-3" />
        </label>
        <Button type="submit" variant="secondary">
          {ph("Search")}
        </Button>
      </form>
      <DataTable
        caption={ph("Shifts")}
        columns={[
          { key: "cashier", header: ph("Cashier"), cell: (row) => <Link href={`/shifts/${row.id}`}>{row.cashierName}</Link> },
          { key: "status", header: ph("Status"), cell: (row) => row.status },
          { key: "opening", header: ph("Opening"), cell: (row) => row.openingCash ?? "" },
          { key: "expected", header: ph("Expected"), cell: (row) => row.expectedCash ?? "" },
          { key: "difference", header: ph("Difference"), cell: (row) => row.difference ?? "" },
        ]}
        rows={shifts}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No shifts")} description={ph("Open a shift with the cash already in the drawer.")} />}
      />
    </div>
  );
}
