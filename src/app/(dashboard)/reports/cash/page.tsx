import { redirect } from "next/navigation";

import { DateFilter, ReportNote } from "@/components/reports/filter";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { cashReport } from "@/modules/reports/reports";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Cash report");

export default async function CashReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const query = await searchParams;
  const report = await cashReport({ organizationId: session.organizationId, branchId: session.branchId, from: query.from, to: query.to });

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Cash report")}
        description={`Account 1100. Debit ${report.debit}. Credit ${report.credit}.`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Reports", href: "/reports" }, { label: ph("Cash") }]}
        actions={<Button href="/reports" variant="secondary">{ph("Back to reports")}</Button>}
      />
      <DateFilter from={query.from} to={query.to} />
      <ReportNote count={report.count} shown={report.rows.length} />
      <DataTable
        caption={ph("Cash lines")}
        columns={[
          { key: "date", header: ph("Date"), cell: (row) => row.businessDate },
          { key: "reference", header: ph("Reference"), cell: (row) => row.reference },
          { key: "debit", header: ph("In"), cell: (row) => row.debit },
          { key: "credit", header: ph("Out"), cell: (row) => row.credit },
        ]}
        rows={report.rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No cash lines")} description={ph("Posted lines on account 1100 appear here.")} />}
      />
    </div>
  );
}
