import { redirect } from "next/navigation";

import { DateFilter } from "@/components/reports/filter";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { dueSaleReport } from "@/modules/reports/reports";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Due sale report");

export default async function DueSalePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const query = await searchParams;
  const report = await dueSaleReport({ organizationId: session.organizationId, branchId: session.branchId, from: query.from, to: query.to });

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Due sale report")}
        description={ph("Due is the sale total minus every payment and every posted return. The latest 100 posted sales are checked.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Reports", href: "/reports" }, { label: ph("Due sales") }]}
        actions={<Button href="/reports" variant="secondary">{ph("Back to reports")}</Button>}
      />
      <DateFilter from={query.from} to={query.to} />
      <DataTable
        caption={ph("Due sales")}
        columns={[
          { key: "date", header: ph("Date"), cell: (row) => row.businessDate },
          { key: "number", header: ph("Invoice"), cell: (row) => row.number },
          { key: "party", header: ph("Customer"), cell: (row) => row.party },
          { key: "total", header: ph("Total"), cell: (row) => row.total },
          { key: "cash", header: ph("Cash"), cell: (row) => row.cash },
          { key: "due", header: ph("Due"), cell: (row) => row.due },
        ]}
        rows={report.rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No due sales")} description={ph("A posted sale with cash below the total appears here.")} />}
      />
    </div>
  );
}
