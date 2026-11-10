import Link from "next/link";
import { redirect } from "next/navigation";

import { ProductPhotoForm } from "@/components/catalog/product-photo";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listCatalogTable } from "@/modules/catalog/products";

export const metadata = { title: "All Products" };

function clean(value: string | undefined) {
  return value?.trim() ?? "";
}

function pageNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function pageSize(value: string | undefined) {
  const parsed = Number(value);
  return parsed === 25 || parsed === 50 || parsed === 100 || parsed === 200 ? parsed : 25;
}

function listHref(input: { q: string; status: string; size: number; page: number }) {
  const params = new URLSearchParams();
  if (input.q) {
    params.set("q", input.q);
  }
  if (input.status) {
    params.set("status", input.status);
  }
  if (input.size !== 25) {
    params.set("size", String(input.size));
  }
  if (input.page > 1) {
    params.set("page", String(input.page));
  }
  const query = params.toString();
  return query ? `/products?${query}` : "/products";
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; size?: string; page?: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const params = await searchParams;
  const q = clean(params.q);
  const status = params.status === "ACTIVE" || params.status === "INACTIVE" ? params.status : "";
  const size = pageSize(params.size);
  const table = await listCatalogTable(session.organizationId, {
    search: q,
    status,
    size,
    page: pageNumber(params.page),
  });
  const start = table.total === 0 ? 0 : (table.page - 1) * table.size + 1;
  const end = Math.min(table.page * table.size, table.total);

  return (
    <div className="space-y-4">
      <PageHeader
        title="All Products"
        description="Stock in is every inward movement except a customer return. Stock out is every outward movement. Current stock is the balance on hand."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "All Products" }]}
        actions={session.permissions.has("products.create") ? <Button href="/products/new">Add New Product</Button> : null}
      />
      <section className="rounded-2xl border border-border bg-surface p-4">
        <form className="flex flex-wrap items-end gap-2" action="/products">
          <label className="grid min-w-56 flex-1 gap-1 text-sm">
            Search
            <input name="q" defaultValue={q} placeholder="Name or SKU" className="h-10 rounded-md border border-border px-3" />
          </label>
          <label className="grid gap-1 text-sm">
            Status
            <select name="status" defaultValue={status} className="h-10 rounded-md border border-border bg-surface px-2">
              <option value="">Active and deactive</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Deactive</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Show
            <select name="size" defaultValue={String(size)} className="h-10 rounded-md border border-border bg-surface px-2">
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
          </label>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <p className="mt-3 text-sm text-muted">
          Showing {start}–{end} of {table.total}
        </p>
        <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse text-sm">
              <thead className="bg-surface-muted text-left text-xs text-muted">
                <tr>
                  {["#", "Product info", "Image", "P. Price", "S. Price", "Stock in", "Stock out", "Total return", "Current stock", "Stock value (avg cost)", "Total S. value", "Action"].map((header) => (
                    <th key={header} className="px-2 py-2 font-medium">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-2 py-8">
                      <EmptyState title="No products" description="Create a product to start tracking stock." />
                    </td>
                  </tr>
                ) : (
                  table.rows.map((row, index) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-2 py-2">{start + index}</td>
                    <td className="px-2 py-2">
                      <span className="block font-medium">{row.name}</span>
                      <span className="text-xs text-muted">{row.sku}</span>
                      <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] ${row.status === "ACTIVE" ? "bg-success-subtle text-success" : "bg-error-subtle text-error"}`}>
                        {row.status === "ACTIVE" ? "Active" : "Deactive"}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      {session.permissions.has("products.edit") || session.permissions.has("products.create") ? (
                        <ProductPhotoForm productId={row.id} hasImage={row.hasImage} />
                      ) : row.hasImage ? (
                        <img src={`/api/v1/products/${row.id}/image`} alt="" className="size-10 rounded-md object-cover" />
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2">{row.purchasePrice}</td>
                    <td className="px-2 py-2">{row.sellingPrice}</td>
                    <td className="px-2 py-2">{row.stockIn}</td>
                    <td className="px-2 py-2">{row.stockOut}</td>
                    <td className="px-2 py-2">{row.totalReturn}</td>
                    <td className="px-2 py-2">{row.currentStock}</td>
                    <td className="px-2 py-2">{row.stockValue}</td>
                    <td className="px-2 py-2">{row.sellingValue}</td>
                    <td className="px-2 py-2">
                      <Link href="/inventory/ledger" className="text-info">
                        Ledger
                      </Link>
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          {table.page > 1 ? (
            <Link href={listHref({ q, status, size, page: table.page - 1 })} className="rounded-md border border-border px-3 py-1.5 text-sm">
              Previous
            </Link>
          ) : null}
          <span className="text-sm text-muted">
            {table.page} / {table.pageCount}
          </span>
          {table.page < table.pageCount ? (
            <Link href={listHref({ q, status, size, page: table.page + 1 })} className="rounded-md border border-border px-3 py-1.5 text-sm">
              Next
            </Link>
          ) : null}
        </div>
      </section>
    </div>
  );
}
