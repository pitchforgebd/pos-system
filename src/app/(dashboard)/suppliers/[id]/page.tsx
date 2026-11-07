import { notFound, redirect } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { getSupplier } from "@/modules/purchasing/suppliers";

export const metadata = { title: "Supplier" };

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const { id } = await params;
  const supplier = await getSupplier(session.organizationId, id);
  if (!supplier) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={supplier.name}
        description={`Outstanding payable ${supplier.outstanding}`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Suppliers", href: "/suppliers" }, { label: supplier.name }]}
      />
      <DataTable
        caption="Supplier ledger"
        columns={[
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "type", header: "Type", cell: (row) => row.entryType },
          { key: "debit", header: "Debit", cell: (row) => row.debit },
          { key: "credit", header: "Credit", cell: (row) => row.credit },
        ]}
        rows={supplier.ledger}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No ledger rows" description="Purchases and payments will appear here." />}
      />
    </div>
  );
}
