import { redirect } from "next/navigation";

import { ReportNote } from "@/components/reports/filter";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { inventoryReport } from "@/modules/reports/reports";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Inventory report");

const statusLabel = { OUT_OF_STOCK: "Out of stock", LOW: "Low", NORMAL: "Normal" };

export default async function InventoryReportPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const report = await inventoryReport({ organizationId: session.organizationId, branchId: session.branchId });

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Inventory report")}
        description={ph("One row per stock balance on this branch. Status uses the product reorder level.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Reports", href: "/reports" }, { label: ph("Inventory") }]}
        actions={<Button href="/reports" variant="secondary">{ph("Back to reports")}</Button>}
      />
      <ReportNote count={report.count} shown={report.rows.length} />
      <DataTable
        caption={ph("Stock balances")}
        columns={[
          { key: "sku", header: ph("SKU"), cell: (row) => row.sku },
          { key: "product", header: ph("Product"), cell: (row) => row.product },
          { key: "warehouse", header: ph("Warehouse"), cell: (row) => row.warehouse },
          { key: "quantity", header: ph("Stock"), cell: (row) => row.quantity },
          { key: "status", header: ph("Status"), cell: (row) => statusLabel[row.status] },
        ]}
        rows={report.rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No stock")} description={ph("Stock balances on this branch appear here.")} />}
      />
    </div>
  );
}
