import { redirect } from "next/navigation";

import { DealerForm } from "@/components/reference/gap-forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listCustomers } from "@/modules/customers/customers";
import { listDealers } from "@/modules/reference/extras";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Dealer Wings");

export default async function DealersPage() {
  const ph = await getPhrase();
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
        title={ph("Dealer Wings")}
        description={ph("A dealer is a customer with the Dealer type. Marking a customer does not open a separate account.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Customers", href: "/customers" }, { label: ph("Dealers") }]}
      />
      {session.permissions.has("customers.edit") ? (
        <DealerForm
          customers={customers
            .filter((customer) => customer.status === "ACTIVE" && !dealerIds.has(customer.id))
            .map((customer) => ({ id: customer.id, label: customer.name }))}
        />
      ) : null}
      <DataTable
        caption={ph("Dealers")}
        columns={[
          { key: "name", header: ph("Dealer"), cell: (row) => row.name },
          { key: "phone", header: ph("Phone"), cell: (row) => row.phone ?? "" },
        ]}
        rows={dealers}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No dealers")} description={ph("Mark an existing customer as a dealer.")} />}
      />
    </div>
  );
}
