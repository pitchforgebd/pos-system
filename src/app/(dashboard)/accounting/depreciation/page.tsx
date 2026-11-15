import Link from "next/link";
import { redirect } from "next/navigation";

import { RunDepreciationForm } from "@/components/assets/forms";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { businessDate } from "@/core/time/business-date";
import { getSession } from "@/modules/auth/current-session";
import { addMonths, listRuns, previewDepreciation } from "@/modules/assets/assets";

export const metadata = { title: "Depreciation" };

export default async function DepreciationPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const thisMonth = businessDate().slice(0, 7);
  const asked = (await searchParams).month;
  const runs = await listRuns(session.organizationId);
  const next = runs[0] ? addMonths(runs[0].month, 1) : addMonths(thisMonth, -1);
  const month = asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : next <= thisMonth ? next : thisMonth;
  const preview = await previewDepreciation(session.organizationId, month);
  const canPost = session.permissions.has("accounting.post");
  const future = month > thisMonth;
  const outOfOrder = Boolean(runs[0] && runs[0].month > month);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Monthly depreciation"
        description="Choose a month, check what each asset writes off, and post it as one journal (Depreciation / Accumulated Depreciation). Straight line; the last month takes the rounding. Each month once, in order."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: "Fixed assets", href: "/accounting/assets" }, { label: "Depreciation" }]}
      />
      <form className="flex flex-wrap items-end gap-2" action="/accounting/depreciation">
        <label className="grid gap-1 text-sm">
          Month
          <input name="month" type="month" defaultValue={month} max={thisMonth} className="h-10 rounded-md border border-border px-3" />
        </label>
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>
      <section className="space-y-3" aria-label="Preview">
        <h2 className="text-lg font-semibold">{month}</h2>
        {preview.done ? (
          <p className="text-sm">
            Done: {preview.done.total} was posted. <Link href={`/accounting/journals/${preview.done.journalId}`}>See the journal</Link>
          </p>
        ) : (
          <>
            <DataTable
              caption="What each asset writes off"
              columns={[
                { key: "code", header: "Code", cell: (row) => <Link href={`/accounting/assets/${row.id}`}>{row.code}</Link> },
                { key: "name", header: "Asset", cell: (row) => row.name },
                { key: "cost", header: "Cost", cell: (row) => row.cost },
                { key: "accumulated", header: "Written off so far", cell: (row) => row.accumulated },
                { key: "amount", header: "This month", cell: (row) => row.amount },
                { key: "after", header: "Worth after", cell: (row) => row.bookValueAfter },
              ]}
              rows={preview.rows.map((row) => ({ ...row, amount: row.amount.toFixed(2) }))}
              getRowKey={(row) => row.id}
              empty={<EmptyState title="Nothing to write off" description="No asset in use has anything left to depreciate for this month." />}
            />
            <p className="text-sm">Total {preview.total}</p>
            {future ? <p className="text-sm text-muted">This month has not started yet.</p> : null}
            {outOfOrder ? <p className="text-sm text-muted">A later month is already posted: months go in order.</p> : null}
            {canPost && preview.rows.length > 0 && !future && !outOfOrder ? <RunDepreciationForm month={month} total={preview.total} /> : null}
          </>
        )}
      </section>
      <DataTable
        caption="Months posted"
        columns={[
          { key: "month", header: "Month", cell: (row) => row.month },
          { key: "assets", header: "Assets", cell: (row) => row.assets },
          { key: "total", header: "Total", cell: (row) => <Link href={`/accounting/journals/${row.journalId}`}>{row.total}</Link> },
        ]}
        rows={runs}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No month posted yet" description="Each month's depreciation shows here once it is posted." />}
      />
    </div>
  );
}
