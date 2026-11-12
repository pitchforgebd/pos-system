import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Pagination } from "@/components/ui/pagination";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { listQuery } from "@/core/list";
import { getSession } from "@/modules/auth/current-session";
import { listPurchases, purchaseSorts } from "@/modules/purchasing/purchases";

export const metadata = { title: "Purchases" };

const STATUSES = ["DRAFT", "ORDERED", "RECEIVED", "CANCELLED"] as const;
const TONE = { DRAFT: "neutral", ORDERED: "info", RECEIVED: "success", CANCELLED: "error" } as const;

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string; pageSize?: string; sort?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const params = await searchParams;
  const status = STATUSES.find((value) => value === params.status);
  // The search runs in SQL, so it finds a purchase on any page, not only among the rows that were loaded.
  const { rows: purchases, page } = await listPurchases(session.organizationId, session.branchId, listQuery(params, { sorts: purchaseSorts }), params.q ?? "", status);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchases"
        description="A purchase is written down, ordered from the vendor, then received: only then does stock and what is owed to the vendor change."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Purchases" }]}
        actions={session.permissions.has("purchase.create") ? <Button href="/purchases/new">New purchase</Button> : null}
      />
      <form className="flex flex-wrap items-end gap-2" action="/purchases">
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          Search
          <input name="q" defaultValue={params.q ?? ""} placeholder="Number, vendor's invoice or supplier" className="h-10 rounded-md border border-border px-3" />
        </label>
        <label className="grid gap-1 text-sm">
          Status
          <select name="status" defaultValue={status ?? ""} className="h-10 rounded-md border border-border bg-surface px-2">
            <option value="">All</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value.charAt(0) + value.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <DataTable
        caption="Purchases"
        columns={[
          { key: "number", header: "Number", cell: (row) => <Link href={`/purchases/${row.id}`}>{row.number ?? "Draft"}</Link> },
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "supplier", header: "Supplier", cell: (row) => row.supplierName },
          { key: "invoice", header: "Vendor's invoice", cell: (row) => row.supplierInvoiceNo ?? "" },
          { key: "total", header: "Total", cell: (row) => row.total },
          { key: "status", header: "Status", cell: (row) => <StatusBadge tone={TONE[row.status as keyof typeof TONE] ?? "neutral"}>{row.status}</StatusBadge> },
        ]}
        rows={purchases}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No purchases" description="Write a purchase down or receive goods from a supplier." />}
      />
      {page.total > page.pageSize ? (
        <Pagination
          page={page.page}
          pageCount={page.pageCount}
          total={page.total}
          pageSize={page.pageSize}
          path="/purchases"
          params={{ ...(params.q ? { q: params.q } : {}), ...(status ? { status } : {}), ...(params.sort ? { sort: params.sort } : {}), ...(page.pageSize !== 25 ? { pageSize: page.pageSize } : {}) }}
        />
      ) : null}
    </div>
  );
}
