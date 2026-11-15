import { redirect } from "next/navigation";

import { ReportNote } from "@/components/reports/filter";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { supplierReport } from "@/modules/reports/reports";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Supplier report");

export default async function SupplierReportPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const report = await supplierReport(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Supplier report")}
        description={ph("Payable is ledger credit minus ledger debit. The opening column is not added again.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Reports", href: "/reports" }, { label: ph("Suppliers") }]}
        actions={<Button href="/reports" variant="secondary">{ph("Back to reports")}</Button>}
      />
      <ReportNote count={report.count} shown={report.rows.length} />
      <DataTable
        caption={ph("Suppliers")}
        columns={[
          { key: "name", header: ph("Supplier"), cell: (row) => row.name },
          { key: "payable", header: ph("Payable"), cell: (row) => row.payable },
        ]}
        rows={report.rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No suppliers")} description={ph("Supplier payables appear here.")} />}
      />
    </div>
  );
}
