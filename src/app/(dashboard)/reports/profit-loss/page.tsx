import { redirect } from "next/navigation";

import { DateFilter } from "@/components/reports/filter";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { profitAndLoss } from "@/modules/reports/reports";

export const metadata = { title: "Profit and loss" };

export default async function ProfitLossPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const query = await searchParams;
  const report = await profitAndLoss({ organizationId: session.organizationId, branchId: session.branchId, from: query.from, to: query.to });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profit and loss"
        description={`Revenue ${report.revenue}. Cost of sales ${report.cost}. Gross profit ${report.gross}. Expenses ${report.expenses}. Net ${report.net}.`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Reports", href: "/reports" }, { label: "Profit and loss" }]}
        actions={<Button href="/reports" variant="secondary">Back to reports</Button>}
      />
      <DateFilter from={query.from} to={query.to} />
      <p className="text-sm text-muted">Revenue is group 4000. Cost of sales is group 5000. Expenses are group 6000. Other groups are omitted.</p>
      <DataTable
        caption="Posted accounts"
        columns={[
          { key: "code", header: "Account", cell: (row) => `${row.code} ${row.name}` },
          { key: "group", header: "Group", cell: (row) => row.group },
          { key: "amount", header: "Amount", cell: (row) => row.amount },
        ]}
        rows={report.rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No posted profit or loss" description="Posted revenue, cost, and expense accounts appear here." />}
      />
    </div>
  );
}
