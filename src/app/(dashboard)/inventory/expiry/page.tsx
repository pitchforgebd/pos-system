import { redirect } from "next/navigation";

import { ExpiryWriteOffForm, PrintButton } from "@/components/inventory/stock-forms";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { listBrands, listCategories } from "@/modules/catalog/references";
import { getSession } from "@/modules/auth/current-session";
import { listExpiry } from "@/modules/inventory/documents";

export const metadata = { title: "Expired Products List" };

function recordId(value: string | undefined) {
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
}

function daysLeft(expiresOn: string) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const expiry = new Date(`${expiresOn}T00:00:00.000Z`);
  const days = Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
  return days < 0 ? "Already expired" : String(days);
}

export default async function ExpiryPage({
  searchParams,
}: {
  searchParams: Promise<{ lot?: string; generic?: string; brandId?: string; categoryId?: string; status?: string }>;
}) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const params = await searchParams;
  const brandId = recordId(params.brandId);
  const categoryId = recordId(params.categoryId);
  const [lots, brands, categories] = await Promise.all([
    listExpiry({
      organizationId: session.organizationId,
      branchId: session.branchId,
      lot: params.lot?.trim() || undefined,
      generic: params.generic?.trim() || undefined,
      brandId,
      categoryId,
    }),
    listBrands(session.organizationId),
    listCategories(session.organizationId),
  ]);
  const status = params.status === "EXPIRED" || params.status === "IN_DATE" ? params.status : "";
  const rows = status ? lots.filter((row) => row.status === status) : lots;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expired Products List"
        description="Expired means the date is before today in UTC. Generic is the category name. Days left is counted from that same date."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Expired Products List" }]}
      />
      <form className="flex flex-wrap items-end gap-2" action="/inventory/expiry">
        <label className="grid gap-1 text-sm">
          Lot
          <input name="lot" defaultValue={params.lot ?? ""} className="h-10 rounded-md border border-border px-3" />
        </label>
        <label className="grid gap-1 text-sm">
          Generic
          <input name="generic" defaultValue={params.generic ?? ""} className="h-10 rounded-md border border-border px-3" />
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
          Category
          <select name="categoryId" defaultValue={categoryId ?? ""} className="h-10 rounded-md border border-border bg-surface px-2">
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Status
          <select name="status" defaultValue={status} className="h-10 rounded-md border border-border bg-surface px-2">
            <option value="">All</option>
            <option value="EXPIRED">Already expired</option>
            <option value="IN_DATE">In date</option>
          </select>
        </label>
        <Button type="submit" variant="secondary">
          Search
        </Button>
        <PrintButton />
      </form>
      <div className="print-sheet">
      <DataTable
        caption="Expiry lots"
        columns={[
          { key: "sku", header: "SKU", cell: (row) => row.sku },
          { key: "name", header: "Product", cell: (row) => row.name },
          { key: "generic", header: "Generic", cell: (row) => row.category },
          { key: "lot", header: "Lot", cell: (row) => row.lot },
          { key: "made", header: "Manufacture", cell: (row) => row.manufacturedOn ?? "" },
          { key: "expires", header: "Expiry", cell: (row) => row.expiresOn },
          { key: "days", header: "Days left", cell: (row) => daysLeft(row.expiresOn) },
          { key: "quantity", header: "Quantity", cell: (row) => row.quantity },
          { key: "status", header: "Status", cell: (row) => (row.status === "EXPIRED" ? "Already expired" : "In date") },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No lots" description="Expiry lots are created when opening stock is posted for a product that tracks expiry." />}
      />
      </div>
      {session.permissions.has("inventory.expiry") ? (
        <ExpiryWriteOffForm batches={rows.map((row) => ({ id: row.id, label: `${row.sku} · ${row.lot} · ${row.quantity}` }))} />
      ) : null}
    </div>
  );
}
