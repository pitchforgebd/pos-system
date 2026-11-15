import { redirect } from "next/navigation";

import { ReportNote } from "@/components/reports/filter";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { customerReport } from "@/modules/reports/reports";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Customer report");

export default async function CustomerReportPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const report = await customerReport(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Customer report")}
        description={ph("Due is ledger debit minus ledger credit. The opening column is not added again.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Reports", href: "/reports" }, { label: ph("Customers") }]}
        actions={<Button href="/reports" variant="secondary">{ph("Back to reports")}</Button>}
      />
      <ReportNote count={report.count} shown={report.rows.length} />
      <DataTable
        caption={ph("Customers")}
        columns={[
          { key: "name", header: ph("Customer"), cell: (row) => row.name },
          { key: "due", header: ph("Due"), cell: (row) => row.due },
        ]}
        rows={report.rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No customers")} description={ph("Customer dues appear here.")} />}
      />
    </div>
  );
}
