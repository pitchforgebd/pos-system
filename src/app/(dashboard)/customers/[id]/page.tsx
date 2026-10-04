import { notFound, redirect } from "next/navigation";

import { CustomerEditForm } from "@/components/customers/forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { getCustomer, listCustomerTypes } from "@/modules/customers/customers";

export const metadata = { title: "Customer" };

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const { id } = await params;
  const customer = await getCustomer(session.organizationId, id);
  if (!customer) {
    notFound();
  }
  const types = await listCustomerTypes(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={customer.name}
        description={`Outstanding due ${customer.outstanding}`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Customers", href: "/customers" }, { label: customer.name }]}
      />
      {session.permissions.has("customers.edit") ? (
        <CustomerEditForm
          customer={customer}
          types={types.filter((type) => type.status === "ACTIVE" || type.id === customer.customerTypeId).map((type) => ({ id: type.id, label: type.name }))}
        />
      ) : null}
      <DataTable
        caption="Customer ledger"
        columns={[
          { key: "date", header: "Date", cell: (row) => row.occurredOn },
          { key: "type", header: "Type", cell: (row) => row.entryType },
          { key: "debit", header: "Debit", cell: (row) => row.debit },
          { key: "credit", header: "Credit", cell: (row) => row.credit },
        ]}
        rows={customer.ledger}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No ledger lines" description="A credit sale, payment, return, or advance writes a line." />}
      />
    </div>
  );
}
