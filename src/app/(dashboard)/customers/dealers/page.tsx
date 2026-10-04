import { redirect } from "next/navigation";

import { DealerForm } from "@/components/reference/gap-forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listCustomers } from "@/modules/customers/customers";
import { listDealers } from "@/modules/reference/extras";

export const metadata = { title: "Dealer Wings" };

export default async function DealersPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const [dealers, customers] = await Promise.all([
    listDealers(session.organizationId),
    listCustomers(session.organizationId),
  ]);
  const dealerIds = new Set(dealers.map((dealer) => dealer.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dealer Wings"
        description="A dealer is a customer with the Dealer type. Marking a customer does not open a separate account."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Customers", href: "/customers" }, { label: "Dealers" }]}
      />
      {session.permissions.has("customers.edit") ? (
        <DealerForm
          customers={customers
            .filter((customer) => customer.status === "ACTIVE" && !dealerIds.has(customer.id))
            .map((customer) => ({ id: customer.id, label: customer.name }))}
        />
      ) : null}
      <DataTable
        caption="Dealers"
        columns={[
          { key: "name", header: "Dealer", cell: (row) => row.name },
          { key: "phone", header: "Phone", cell: (row) => row.phone ?? "" },
        ]}
        rows={dealers}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No dealers" description="Mark an existing customer as a dealer." />}
      />
    </div>
  );
}
