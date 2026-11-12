import Link from "next/link";
import { redirect } from "next/navigation";

import { PrintButton } from "@/components/inventory/stock-forms";
import { ReorderDraftsButton } from "@/components/purchasing/reorder-button";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/states";
import { listQuery } from "@/core/list";
import { listBrands, listCategories } from "@/modules/catalog/references";
import { getSession } from "@/modules/auth/current-session";
import { expiryWarnings, listLowStock, reorderList } from "@/modules/inventory/alerts";

export const metadata = { title: "Stock Alert Quantity" };

function recordId(value: string | undefined) {
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
}

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; brandId?: string; categoryId?: string; page?: string; pageSize?: string }>;
}) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const brandId = recordId(params.brandId);
  const categoryId = recordId(params.categoryId);
  const filter = { organizationId: session.organizationId, branchId: session.branchId, search: q || undefined, brandId, categoryId };
  const [low, reorder, expiry, brands, categories] = await Promise.all([
    listLowStock({ ...filter, query: listQuery({ page: params.page, pageSize: params.pageSize }, { sorts: { name: [{ id: "asc" }] }, defaultSort: "name" }) }),
    reorderList(session.organizationId, session.branchId),
    expiryWarnings(session.organizationId, session.branchId),
    listBrands(session.organizationId),
    listCategories(session.organizationId),
  ]);
  const brandName = new Map(brands.map((brand) => [brand.id, brand.name]));
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));
  const keep: Record<string, string> = {};
  if (q) keep.q = q;
  if (brandId) keep.brandId = brandId;
  if (categoryId) keep.categoryId = categoryId;

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
      <div className="print-sheet space-y-3">
        <h2 className="text-lg font-semibold">Low and out of stock ({low.page.total})</h2>
        <DataTable
          caption="Stock alerts"
          columns={[
            { key: "sku", header: "SKU", cell: (row) => row.sku },
            { key: "name", header: "Product", cell: (row) => row.name },
            { key: "brand", header: "Brand", cell: (row) => (row.brandId ? brandName.get(row.brandId) ?? "" : "") },
            { key: "generic", header: "Generic", cell: (row) => (row.categoryId ? categoryName.get(row.categoryId) ?? "" : "") },
            { key: "warehouse", header: "Place", cell: (row) => row.warehouseName },
            { key: "quantity", header: "Quantity", cell: (row) => row.quantity },
            { key: "reorder", header: "Reorder level", cell: (row) => row.reorderLevel },
            { key: "alert", header: "Status", cell: (row) => row.alert },
          ]}
          rows={low.rows}
          getRowKey={(row) => row.id}
          empty={<EmptyState title="No alerts" description="Nothing is low or out of stock on this branch." />}
        />
        <Pagination page={low.page.page} pageCount={low.page.pageCount} total={low.page.total} pageSize={low.page.pageSize} path="/inventory/alerts" params={keep} />
      </div>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Reorder list</h2>
        <p className="text-sm text-muted">Suggested is enough for the next 30 days at the recent selling rate, or twice the reorder level, whichever is more, less what is on hand.</p>
        {session.permissions.has("purchase.create") && reorder.some((row) => row.lastVendorId && Number(row.suggested) > 0) ? <ReorderDraftsButton /> : null}
        <DataTable
          caption="Reorder list"
          columns={[
            { key: "sku", header: "SKU", cell: (row) => row.sku },
            { key: "name", header: "Product", cell: (row) => row.name },
            { key: "onHand", header: "On hand", cell: (row) => row.onHand },
            { key: "vendor", header: "Last vendor", cell: (row) => row.lastVendor || "—" },
            { key: "cost", header: "Last price", cell: (row) => row.lastCost || "—" },
            { key: "sold", header: "Sold, 30 days", cell: (row) => row.sold30 },
            { key: "avg", header: "Per day", cell: (row) => row.avgPerDay },
            { key: "suggested", header: "Suggested", cell: (row) => row.suggested },
          ]}
          rows={reorder}
          getRowKey={(row) => row.productId}
          empty={<EmptyState title="Nothing to reorder" description="No product is at or below its reorder level." />}
        />
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Expiry warnings</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          {expiry.buckets.map((bucket) => (
            <p key={bucket.label} className="rounded-xl border border-border bg-surface px-4 py-3 text-sm">
              {bucket.label}
              <span className="mt-1 block text-lg font-semibold">
                {bucket.lots} lot(s) · {bucket.quantity}
              </span>
            </p>
          ))}
        </div>
        <DataTable
          caption="Lots near expiry"
          columns={[
            { key: "sku", header: "SKU", cell: (row) => row.sku },
            { key: "name", header: "Product", cell: (row) => row.name },
            { key: "lot", header: "Lot", cell: (row) => row.lot },
            { key: "warehouse", header: "Place", cell: (row) => row.warehouseName },
            { key: "quantity", header: "Quantity", cell: (row) => row.quantity },
            { key: "expires", header: "Expires", cell: (row) => row.expiresOn },
            { key: "days", header: "Days left", cell: (row) => (row.daysLeft < 0 ? `expired ${-row.daysLeft} day(s) ago` : row.daysLeft) },
            { key: "action", header: "", cell: (row) => (row.daysLeft < 0 ? <Link href="/inventory/expiry">Write off</Link> : null) },
          ]}
          rows={expiry.lots}
          getRowKey={(row) => row.id}
          empty={<EmptyState title="No lots near expiry" description="No lot with stock expires within 90 days." />}
        />
      </section>
    </div>
  );
}
