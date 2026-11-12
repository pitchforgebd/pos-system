import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/states";
import { listQuery } from "@/core/list";
import { businessDate } from "@/core/time/business-date";
import { getSession } from "@/modules/auth/current-session";
import { listSales, saleSorts } from "@/modules/sales/sales";

export const metadata = { title: "POS history" };

type SearchParams = Promise<{ page?: string; pageSize?: string; sort?: string; scope?: string; date?: string }>;

// The cashier's own invoices of the day (their shift's, until shifts carry the sales in P08), with a reprint. A manager sees the whole branch.
export default async function PosHistoryPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const params = await searchParams;
  const wholeBranch = params.scope === "branch" && session.permissions.has("sales.edit");
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : businessDate();
  const { rows, page } = await listSales(session.organizationId, session.branchId, listQuery(params, { sorts: saleSorts }), { createdById: wholeBranch ? undefined : session.userId, date });
  const keep = { ...(wholeBranch ? { scope: "branch" } : {}), date };

  return (
    <div className="space-y-6">
      <PageHeader
        title="POS history"
        description={wholeBranch ? `All the branch's invoices of ${date}.` : `Your invoices of ${date}.`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Register", href: "/pos" }, { label: "History" }]}
        actions={
          <div className="flex gap-2">
            {session.permissions.has("sales.edit") ? (
              <Button href={wholeBranch ? `/pos/history?date=${date}` : `/pos/history?scope=branch&date=${date}`} variant="secondary">
                {wholeBranch ? "Only mine" : "Whole branch"}
              </Button>
            ) : null}
            <Button href="/pos">New sale</Button>
          </div>
        }
      />
      <form className="flex items-end gap-2" action="/pos/history">
        {wholeBranch ? <input type="hidden" name="scope" value="branch" /> : null}
        <label className="grid gap-1 text-sm">
          Day
          <input name="date" type="date" defaultValue={date} className="h-10 rounded-md border border-border px-2" />
        </label>
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>
      <DataTable
        caption="Invoices"
        columns={[
          { key: "number", header: "Invoice", cell: (row) => <Link href={`/sales/${row.id}`}>{row.number ?? "Sale"}</Link> },
          { key: "customer", header: "Customer", cell: (row) => row.customerName },
          { key: "total", header: "Total", cell: (row) => row.total },
          { key: "status", header: "Status", cell: (row) => row.status },
          {
            key: "print",
            header: "Reprint",
            cell: (row) => (
              <span className="flex gap-3">
                <Link href={`/sales/${row.id}`}>A4</Link>
                <Link href={`/sales/${row.id}?print=thermal`}>80mm</Link>
              </span>
            ),
          },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No invoices" description="Nothing was sold on this day." />}
      />
      {page.total > page.pageSize ? <Pagination page={page.page} pageCount={page.pageCount} total={page.total} pageSize={page.pageSize} path="/pos/history" params={keep} /> : null}
    </div>
  );
}
