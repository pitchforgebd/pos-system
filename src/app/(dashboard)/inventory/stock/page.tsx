import { redirect } from "next/navigation";

import { AdjustmentForm } from "@/components/inventory/stock-forms";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { listProducts } from "@/modules/catalog/products";
import { getSession } from "@/modules/auth/current-session";
import { listStock } from "@/modules/inventory/stock";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Product Stocks");

export default async function StockPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ph = await getPhrase();
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
        title={ph("Product Stocks")}
        description={ph("Current balances for the selected branch. History is the product ledger.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: ph("Product Stocks") }]}
      />
      <form className="flex flex-wrap items-end gap-2" action="/inventory/stock">
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          {ph("Search")}
          <input name="q" defaultValue={q} placeholder={ph("Name or SKU")} className="h-10 rounded-md border border-border px-3" />
        </label>
        <Button type="submit" variant="secondary">
          {ph("Search")}
        </Button>
      </form>
      <DataTable
        caption={ph("Product stocks")}
        columns={[
          { key: "sku", header: ph("SKU"), cell: (row) => row.sku },
          { key: "name", header: ph("Product"), cell: (row) => row.name },
          { key: "warehouse", header: ph("Place"), cell: (row) => row.warehouseName },
          { key: "quantity", header: ph("Current stock"), cell: (row) => row.quantity },
          { key: "value", header: ph("Stock value"), cell: (row) => row.stockValue },
          { key: "sale", header: ph("S. value"), cell: (row) => row.saleValue },
          { key: "alert", header: ph("Alert"), cell: (row) => row.alert },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No stock")} description={ph("Post opening stock to create the first balance.")} />}
      />
      {session.permissions.has("inventory.adjust") ? (
        <AdjustmentForm products={products.map((product) => ({ id: product.id, label: `${product.sku} · ${product.name}` }))} />
      ) : null}
    </div>
  );
}
