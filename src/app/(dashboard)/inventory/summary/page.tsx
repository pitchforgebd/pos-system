import { redirect } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listStock, stockSummary } from "@/modules/inventory/stock";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Product Summary");

export default async function SummaryPage() {
  const ph = await getPhrase();
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
        title={ph("Product Summary")}
        description={ph("Purchase and sale values are the current quantity times the product price. This is not a costing method.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: ph("Product Summary") }]}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Quantity", summary.quantity],
          ["Rows", String(summary.rows)],
          ["Stock value (avg cost)", summary.stockValue],
          ["Sale value", summary.saleValue],
        ].map(([label, amount]) => (
          <article key={label} className="rounded-xl bg-[#2457c5] p-4 text-white">
            <p className="text-xs font-semibold tracking-wide">{ph(label)}</p>
            <p className="mt-3 text-2xl font-semibold">{amount}</p>
          </article>
        ))}
      </div>
      <DataTable
        caption={ph("Product summary")}
        columns={[
          { key: "sku", header: ph("SKU"), cell: (row) => row.sku },
          { key: "name", header: ph("Product"), cell: (row) => row.name },
          { key: "quantity", header: ph("Current stock"), cell: (row) => row.quantity },
          { key: "value", header: ph("Stock value (avg cost)"), cell: (row) => row.stockValue },
          { key: "sale", header: ph("Total S. value"), cell: (row) => row.saleValue },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No stock")} description={ph("The summary is zero until a balance exists.")} />}
      />
    </div>
  );
}
