import { redirect } from "next/navigation";

import { PrintButton } from "@/components/inventory/stock-forms";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { listBrands, listCategories } from "@/modules/catalog/references";
import { getSession } from "@/modules/auth/current-session";
import { listStock } from "@/modules/inventory/stock";

export const metadata = { title: "Stock Alert Quantity" };

function recordId(value: string | undefined) {
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
}

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; brandId?: string; categoryId?: string }>;
}) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const brandId = recordId(params.brandId);
  const categoryId = recordId(params.categoryId);
  const [stock, brands, categories] = await Promise.all([
    listStock({
      organizationId: session.organizationId,
      branchId: session.branchId,
      search: q || undefined,
      brandId,
      categoryId,
    }),
    listBrands(session.organizationId),
    listCategories(session.organizationId),
  ]);
  const rows = stock.filter((row) => row.alert !== "NORMAL");
  const brandName = new Map(brands.map((brand) => [brand.id, brand.name]));
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Alert Quantity"
        description="Low means stock is above zero and at or below the reorder level. Out of stock means zero. Generic is the category."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Stock Alert Quantity" }]}
      />
      <form className="flex flex-wrap items-end gap-2" action="/inventory/alerts">
        <label className="grid min-w-48 flex-1 gap-1 text-sm">
          Search
          <input name="q" defaultValue={q} placeholder="Name or SKU" className="h-10 rounded-md border border-border px-3" />
        </label>
        <label className="grid gap-1 text-sm">
          Brand
          <select name="brandId" defaultValue={brandId ?? ""} className="h-10 rounded-md border border-border bg-surface px-2">
            <option value="">All brands</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Generic
          <select name="categoryId" defaultValue={categoryId ?? ""} className="h-10 rounded-md border border-border bg-surface px-2">
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary">
          Search
        </Button>
        <PrintButton />
      </form>
      <div className="print-sheet">
        <DataTable
          caption="Stock alerts"
          columns={[
            { key: "sku", header: "SKU", cell: (row) => row.sku },
            { key: "name", header: "Product", cell: (row) => row.name },
            { key: "brand", header: "Brand", cell: (row) => (row.brandId ? brandName.get(row.brandId) ?? "" : "") },
            { key: "generic", header: "Generic", cell: (row) => (row.categoryId ? categoryName.get(row.categoryId) ?? "" : "") },
            { key: "quantity", header: "Quantity", cell: (row) => row.quantity },
            { key: "reorder", header: "Reorder level", cell: (row) => row.reorderLevel },
            { key: "alert", header: "Status", cell: (row) => row.alert },
          ]}
          rows={rows}
          getRowKey={(row) => row.id}
          empty={<EmptyState title="No alerts" description="Nothing is low or out of stock on this branch." />}
        />
      </div>
    </div>
  );
}
