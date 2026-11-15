import { redirect } from "next/navigation";

import { DateFilter, ReportNote } from "@/components/reports/filter";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { salesReport } from "@/modules/reports/reports";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Sales report");

export default async function SalesReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const query = await searchParams;
  const report = await salesReport({ organizationId: session.organizationId, branchId: session.branchId, from: query.from, to: query.to });

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Sales report")}
        description={`Total ${report.total} from ${report.count} posted sales. Returns are not subtracted.`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Reports", href: "/reports" }, { label: ph("Sales") }]}
        actions={
          <div className="flex gap-2">
            {session.permissions.has("reports.export") ? (
              <Button href={`/api/v1/reports/sales?format=csv${query.from && query.to ? `&from=${query.from}&to=${query.to}` : ""}`} variant="secondary">
                {ph("Export CSV")}
              </Button>
            ) : null}
            <Button href="/reports" variant="secondary">
              {ph("Back to reports")}
            </Button>
          </div>
        }
      />
      <DateFilter from={query.from} to={query.to} />
      <ReportNote count={report.count} shown={report.rows.length} />
      <DataTable
        caption={ph("Posted sales")}
        columns={[
          { key: "date", header: ph("Date"), cell: (row) => row.businessDate },
          { key: "number", header: ph("Invoice"), cell: (row) => row.number },
          { key: "party", header: ph("Customer"), cell: (row) => row.party },
          { key: "total", header: ph("Total"), cell: (row) => row.total },
        ]}
        rows={report.rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No posted sales")} description={ph("Posted sales on this branch appear here.")} />}
      />
    </div>
  );
}
