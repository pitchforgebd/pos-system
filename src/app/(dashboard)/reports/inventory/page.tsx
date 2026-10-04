import { redirect } from "next/navigation";

import { ReportNote } from "@/components/reports/filter";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { inventoryReport } from "@/modules/reports/reports";

export const metadata = { title: "Inventory report" };

const statusLabel = { OUT_OF_STOCK: "Out of stock", LOW: "Low", NORMAL: "Normal" };

export default async function InventoryReportPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const report = await inventoryReport({ organizationId: session.organizationId, branchId: session.branchId });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory report"
        description="One row per stock balance on this branch. Status uses the product reorder level."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Reports", href: "/reports" }, { label: "Inventory" }]}
        actions={<Button href="/reports" variant="secondary">Back to reports</Button>}
      />
      <ReportNote count={report.count} shown={report.rows.length} />
      <DataTable
        caption="Stock balances"
        columns={[
          { key: "sku", header: "SKU", cell: (row) => row.sku },
          { key: "product", header: "Product", cell: (row) => row.product },
          { key: "warehouse", header: "Warehouse", cell: (row) => row.warehouse },
          { key: "quantity", header: "Stock", cell: (row) => row.quantity },
          { key: "status", header: "Status", cell: (row) => statusLabel[row.status] },
        ]}
        rows={report.rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No stock" description="Stock balances on this branch appear here." />}
      />
    </div>
  );
}
