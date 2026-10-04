import { redirect } from "next/navigation";

import { DateFilter, ReportNote } from "@/components/reports/filter";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { dayBook } from "@/modules/reports/reports";

export const metadata = { title: "Day book" };

export default async function DayBookPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const query = await searchParams;
  const report = await dayBook({ organizationId: session.organizationId, branchId: session.branchId, from: query.from, to: query.to });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Day book"
        description={`Debit ${report.debit}. Credit ${report.credit}.`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Reports", href: "/reports" }, { label: "Day book" }]}
        actions={<Button href="/reports" variant="secondary">Back to reports</Button>}
      />
      <DateFilter from={query.from} to={query.to} />
      <ReportNote count={report.count} shown={report.rows.length} />
      <DataTable
        caption="Posted lines"
        columns={[
          { key: "date", header: "Date", cell: (row) => row.occurredOn },
          { key: "reference", header: "Reference", cell: (row) => row.reference },
          { key: "account", header: "Account", cell: (row) => row.account },
          { key: "debit", header: "Debit", cell: (row) => row.debit },
          { key: "credit", header: "Credit", cell: (row) => row.credit },
        ]}
        rows={report.rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No posted lines" description="Posted journal lines on this branch appear here." />}
      />
    </div>
  );
}
