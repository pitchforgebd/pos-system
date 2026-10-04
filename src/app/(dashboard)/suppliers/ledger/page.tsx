import { redirect } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listSuppliers } from "@/modules/purchasing/suppliers";

export const metadata = { title: "Supplier ledger" };

export default async function SupplierLedgerPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const suppliers = await listSuppliers(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier ledger"
        description="Open a supplier to see the credits and debits. Outstanding is credits minus debits."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Suppliers", href: "/suppliers" }, { label: "Ledger" }]}
      />
      <DataTable
        caption="Supplier balances"
        columns={[
          { key: "name", header: "Supplier", cell: (row) => row.name },
          { key: "outstanding", header: "Outstanding", cell: (row) => row.outstanding },
        ]}
        rows={suppliers}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No suppliers" description="Add a supplier to start a ledger." />}
      />
    </div>
  );
}
