import { redirect } from "next/navigation";

import { DateFilter, ReportNote } from "@/components/reports/filter";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { dayBook } from "@/modules/reports/reports";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Day book");

export default async function DayBookPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const query = await searchParams;
  const report = await dayBook({ organizationId: session.organizationId, branchId: session.branchId, from: query.from, to: query.to });

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Day book")}
        description={`Debit ${report.debit}. Credit ${report.credit}.`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Reports", href: "/reports" }, { label: ph("Day book") }]}
        actions={<Button href="/reports" variant="secondary">{ph("Back to reports")}</Button>}
      />
      <DateFilter from={query.from} to={query.to} />
      <ReportNote count={report.count} shown={report.rows.length} />
      <DataTable
        caption={ph("Posted lines")}
        columns={[
          { key: "date", header: ph("Date"), cell: (row) => row.businessDate },
          { key: "reference", header: ph("Reference"), cell: (row) => row.reference },
          { key: "account", header: ph("Account"), cell: (row) => row.account },
          { key: "debit", header: ph("Debit"), cell: (row) => row.debit },
          { key: "credit", header: ph("Credit"), cell: (row) => row.credit },
        ]}
        rows={report.rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No posted lines")} description={ph("Posted journal lines on this branch appear here.")} />}
      />
    </div>
  );
}
