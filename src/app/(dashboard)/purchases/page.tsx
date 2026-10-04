import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listPurchases } from "@/modules/purchasing/purchases";

export const metadata = { title: "Purchases" };

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const params = await searchParams;
  const q = params.q?.trim().toLowerCase() ?? "";
  const purchases = (await listPurchases(session.organizationId, session.branchId)).filter((row) => {
    if (!q) {
      return true;
    }
    return `${row.number ?? ""} ${row.supplierName}`.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchases"
        description="Each posted purchase increases stock and accounts payable together."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Purchases" }]}
        actions={session.permissions.has("purchase.create") ? <Button href="/purchases/new">New purchase</Button> : null}
      />
      <form className="flex flex-wrap items-end gap-2" action="/purchases">
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          Search
          <input name="q" defaultValue={params.q ?? ""} placeholder="Number or supplier" className="h-10 rounded-md border border-border px-3" />
        </label>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <DataTable
        caption="Purchases"
        columns={[
          { key: "number", header: "Number", cell: (row) => <Link href={`/purchases/${row.id}`}>{row.number}</Link> },
          { key: "date", header: "Date", cell: (row) => row.occurredOn },
          { key: "supplier", header: "Supplier", cell: (row) => row.supplierName },
          { key: "total", header: "Total", cell: (row) => row.total },
          { key: "status", header: "Status", cell: (row) => row.status },
        ]}
        rows={purchases}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No purchases" description="Post a purchase to receive stock from a supplier." />}
      />
    </div>
  );
}
