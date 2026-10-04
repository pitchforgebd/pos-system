import { redirect } from "next/navigation";

import { ReportNote } from "@/components/reports/filter";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { supplierReport } from "@/modules/reports/reports";

export const metadata = { title: "Supplier report" };

export default async function SupplierReportPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const report = await supplierReport(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier report"
        description="Payable is ledger credit minus ledger debit. The opening column is not added again."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Reports", href: "/reports" }, { label: "Suppliers" }]}
        actions={<Button href="/reports" variant="secondary">Back to reports</Button>}
      />
      <ReportNote count={report.count} shown={report.rows.length} />
      <DataTable
        caption="Suppliers"
        columns={[
          { key: "name", header: "Supplier", cell: (row) => row.name },
          { key: "payable", header: "Payable", cell: (row) => row.payable },
        ]}
        rows={report.rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No suppliers" description="Supplier payables appear here." />}
      />
    </div>
  );
}
