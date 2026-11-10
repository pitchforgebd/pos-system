import { redirect } from "next/navigation";

import { AdjustmentForm } from "@/components/inventory/stock-forms";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { listProducts } from "@/modules/catalog/products";
import { getSession } from "@/modules/auth/current-session";
import { listStock } from "@/modules/inventory/stock";

export const metadata = { title: "Product Stocks" };

export default async function StockPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  if (!session.branchId) {
    redirect("/dashboard");
  }
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const [rows, products] = await Promise.all([
    listStock({ organizationId: session.organizationId, branchId: session.branchId, search: q || undefined }),
    listProducts(session.organizationId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Product Stocks"
        description="Current balances for the selected branch. History is the product ledger."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Product Stocks" }]}
      />
      <form className="flex flex-wrap items-end gap-2" action="/inventory/stock">
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          Search
          <input name="q" defaultValue={q} placeholder="Name or SKU" className="h-10 rounded-md border border-border px-3" />
        </label>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <DataTable
        caption="Product stocks"
        columns={[
          { key: "sku", header: "SKU", cell: (row) => row.sku },
          { key: "name", header: "Product", cell: (row) => row.name },
          { key: "warehouse", header: "Place", cell: (row) => row.warehouseName },
          { key: "quantity", header: "Current stock", cell: (row) => row.quantity },
          { key: "value", header: "Stock value", cell: (row) => row.stockValue },
          { key: "sale", header: "S. value", cell: (row) => row.saleValue },
          { key: "alert", header: "Alert", cell: (row) => row.alert },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No stock" description="Post opening stock to create the first balance." />}
      />
      {session.permissions.has("inventory.adjust") ? (
        <AdjustmentForm products={products.map((product) => ({ id: product.id, label: `${product.sku} · ${product.name}` }))} />
      ) : null}
    </div>
  );
}
