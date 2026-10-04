import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listSuppliers } from "@/modules/purchasing/suppliers";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const params = await searchParams;
  const q = params.q?.trim().toLowerCase() ?? "";
  const suppliers = (await listSuppliers(session.organizationId)).filter((row) => {
    if (!q) {
      return true;
    }
    return `${row.name} ${row.phone ?? ""}`.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppliers"
        description="Outstanding payable is the supplier ledger, not a stored balance."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Suppliers" }]}
        actions={
          <>
            {session.permissions.has("suppliers.create") ? <Button href="/suppliers/new">Add supplier</Button> : null}
            {session.permissions.has("suppliers.payment") ? (
              <Button href="/suppliers/payments" variant="secondary">
                Payment
              </Button>
            ) : null}
          </>
        }
      />
      <form className="flex flex-wrap items-end gap-2" action="/suppliers">
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          Search
          <input name="q" defaultValue={params.q ?? ""} placeholder="Name or phone" className="h-10 rounded-md border border-border px-3" />
        </label>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <p className="text-sm text-muted">Showing {suppliers.length}</p>
      <DataTable
        caption="Suppliers"
        columns={[
          { key: "name", header: "Name", cell: (row) => <Link href={`/suppliers/${row.id}`}>{row.name}</Link> },
          { key: "phone", header: "Phone", cell: (row) => row.phone ?? "" },
          { key: "outstanding", header: "Outstanding", cell: (row) => row.outstanding },
          { key: "status", header: "Status", cell: (row) => row.status },
        ]}
        rows={suppliers}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No suppliers" description="Add a supplier before posting a purchase." />}
      />
    </div>
  );
}
