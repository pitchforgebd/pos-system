import { redirect } from "next/navigation";

import { DateFilter } from "@/components/reports/filter";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { paymentMethodReport } from "@/modules/reports/reports";

export const metadata = { title: "Payment-method report" };

export default async function PaymentMethodPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const query = await searchParams;
  const report = await paymentMethodReport({ organizationId: session.organizationId, branchId: session.branchId, from: query.from, to: query.to });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment-method report"
        description="Amounts are cash, bank, and card taken on posted sales. Wallet is not a tender."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Reports", href: "/reports" }, { label: "Payment method" }]}
        actions={<Button href="/reports" variant="secondary">Back to reports</Button>}
      />
      <DateFilter from={query.from} to={query.to} />
      <DataTable
        caption="Methods"
        columns={[
          { key: "method", header: "Method", cell: (row) => row.method },
          { key: "count", header: "Payments", cell: (row) => String(row.count) },
          { key: "amount", header: "Amount", cell: (row) => row.amount },
        ]}
        rows={report.rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No sale payments" description="Cash taken on a posted sale appears here." />}
      />
    </div>
  );
}
