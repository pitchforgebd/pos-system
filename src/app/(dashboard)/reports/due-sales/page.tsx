import { redirect } from "next/navigation";

import { DateFilter } from "@/components/reports/filter";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { dueSaleReport } from "@/modules/reports/reports";

export const metadata = { title: "Due sale report" };

export default async function DueSalePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const query = await searchParams;
  const report = await dueSaleReport({ organizationId: session.organizationId, branchId: session.branchId, from: query.from, to: query.to });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Due sale report"
        description="Due is the sale total minus every payment and every posted return. The latest 100 posted sales are checked."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Reports", href: "/reports" }, { label: "Due sales" }]}
        actions={<Button href="/reports" variant="secondary">Back to reports</Button>}
      />
      <DateFilter from={query.from} to={query.to} />
      <DataTable
        caption="Due sales"
        columns={[
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "number", header: "Invoice", cell: (row) => row.number },
          { key: "party", header: "Customer", cell: (row) => row.party },
          { key: "total", header: "Total", cell: (row) => row.total },
          { key: "cash", header: "Cash", cell: (row) => row.cash },
          { key: "due", header: "Due", cell: (row) => row.due },
        ]}
        rows={report.rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No due sales" description="A posted sale with cash below the total appears here." />}
      />
    </div>
  );
}
