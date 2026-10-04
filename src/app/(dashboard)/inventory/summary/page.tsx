import { redirect } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listStock, stockSummary } from "@/modules/inventory/stock";

export const metadata = { title: "Product Summary" };

export default async function SummaryPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const [summary, rows] = await Promise.all([
    stockSummary(session.organizationId, session.branchId),
    listStock({ organizationId: session.organizationId, branchId: session.branchId }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Product Summary"
        description="Purchase and sale values are the current quantity times the product price. This is not a costing method."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Product Summary" }]}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Quantity", summary.quantity],
          ["Rows", String(summary.rows)],
          ["Purchase value", summary.purchaseValue],
          ["Sale value", summary.saleValue],
        ].map(([label, amount]) => (
          <article key={label} className="rounded-xl bg-[#2457c5] p-4 text-white">
            <p className="text-xs font-semibold tracking-wide">{label}</p>
            <p className="mt-3 text-2xl font-semibold">{amount}</p>
          </article>
        ))}
      </div>
      <DataTable
        caption="Product summary"
        columns={[
          { key: "sku", header: "SKU", cell: (row) => row.sku },
          { key: "name", header: "Product", cell: (row) => row.name },
          { key: "quantity", header: "Current stock", cell: (row) => row.quantity },
          { key: "purchase", header: "Total P. value", cell: (row) => row.purchaseValue },
          { key: "sale", header: "Total S. value", cell: (row) => row.saleValue },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No stock" description="The summary is zero until a balance exists." />}
      />
    </div>
  );
}
