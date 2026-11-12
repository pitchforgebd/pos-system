import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { listQuery } from "@/core/list";
import { getSession } from "@/modules/auth/current-session";
import { listOrders, orderSorts } from "@/modules/orders/orders";

export const metadata = { title: "Quotation" };

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; pageSize?: string; sort?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const params = await searchParams;
  const { rows, page } = await listOrders(session.organizationId, session.branchId, listQuery(params, { sorts: orderSorts }), { quotations: true, q: params.q });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quotations"
        description="A quotation is a draft order with its own number and a valid-until date. Open it to print it or to confirm it when the customer says yes."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Quotations" }]}
        actions={<Button href="/orders/new?quotation=1">New quotation</Button>}
      />
      <form className="flex flex-wrap items-end gap-2" action="/quotations">
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          Search
          <input name="q" defaultValue={params.q ?? ""} placeholder="Number or customer" className="h-10 rounded-md border border-border px-3" />
        </label>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <DataTable
        caption="Quotations"
        columns={[
          { key: "number", header: "Quotation", cell: (row) => <Link href={`/orders/${row.id}`}>{row.quotationNumber ?? "Quotation"}</Link> },
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "customer", header: "Customer", cell: (row) => row.customerName },
          { key: "total", header: "Total", cell: (row) => row.total },
          { key: "status", header: "Status", cell: (row) => <StatusBadge tone={row.status === "DRAFT" ? "neutral" : "success"}>{row.status === "DRAFT" ? "OPEN" : `CONFIRMED · ${row.number ?? ""}`}</StatusBadge> },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No quotations" description="Write a quotation for a customer." />}
      />
      {page.total > page.pageSize ? <Pagination page={page.page} pageCount={page.pageCount} total={page.total} pageSize={page.pageSize} path="/quotations" params={params.q ? { q: params.q } : {}} /> : null}
    </div>
  );
}
