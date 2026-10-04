import { redirect } from "next/navigation";

import { DateFilter, ReportNote } from "@/components/reports/filter";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { purchaseReport } from "@/modules/reports/reports";

export const metadata = { title: "Purchase report" };

export default async function PurchaseReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const query = await searchParams;
  const report = await purchaseReport({ organizationId: session.organizationId, branchId: session.branchId, from: query.from, to: query.to });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase report"
        description={`Total ${report.total} from ${report.count} posted purchases.`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Reports", href: "/reports" }, { label: "Purchases" }]}
        actions={<Button href="/reports" variant="secondary">Back to reports</Button>}
      />
      <DateFilter from={query.from} to={query.to} />
      <ReportNote count={report.count} shown={report.rows.length} />
      <DataTable
        caption="Posted purchases"
        columns={[
          { key: "date", header: "Date", cell: (row) => row.occurredOn },
          { key: "number", header: "Purchase", cell: (row) => row.number },
          { key: "party", header: "Supplier", cell: (row) => row.party },
          { key: "total", header: "Total", cell: (row) => row.total },
        ]}
        rows={report.rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No posted purchases" description="Posted purchases on this branch appear here." />}
      />
    </div>
  );
}
