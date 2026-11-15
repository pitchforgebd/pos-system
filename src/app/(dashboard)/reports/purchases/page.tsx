import { redirect } from "next/navigation";

import { DateFilter, ReportNote } from "@/components/reports/filter";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { purchaseReport } from "@/modules/reports/reports";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Purchase report");

export default async function PurchaseReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const query = await searchParams;
  const report = await purchaseReport({ organizationId: session.organizationId, branchId: session.branchId, from: query.from, to: query.to });

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Purchase report")}
        description={`Total ${report.total} from ${report.count} posted purchases.`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Reports", href: "/reports" }, { label: ph("Purchases") }]}
        actions={<Button href="/reports" variant="secondary">{ph("Back to reports")}</Button>}
      />
      <DateFilter from={query.from} to={query.to} />
      <ReportNote count={report.count} shown={report.rows.length} />
      <DataTable
        caption={ph("Posted purchases")}
        columns={[
          { key: "date", header: ph("Date"), cell: (row) => row.businessDate },
          { key: "number", header: ph("Purchase"), cell: (row) => row.number },
          { key: "party", header: ph("Supplier"), cell: (row) => row.party },
          { key: "total", header: ph("Total"), cell: (row) => row.total },
        ]}
        rows={report.rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No posted purchases")} description={ph("Posted purchases on this branch appear here.")} />}
      />
    </div>
  );
}
