import { redirect } from "next/navigation";

import { PartyAmountForm } from "@/components/customers/party-search";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listCustomerAdvances } from "@/modules/customers/advances";
import { listCustomers } from "@/modules/customers/customers";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Advance Receive");

export default async function CustomerAdvancesPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const [customers, advances] = await Promise.all([
    listCustomers(session.organizationId),
    listCustomerAdvances(session.organizationId, session.branchId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Advance Receive")}
        description={ph("An advance is its own record. It can be more than the outstanding due, and it is not a wallet payment.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: ph("Customer Advance") }]}
      />
      {session.permissions.has("customers.advance") ? (
        <PartyAmountForm
          title={ph("Advance Receive")}
          url="/api/v1/customer-advances"
          mode="advance"
          parties={customers
            .filter((customer) => customer.status === "ACTIVE")
            .map((customer) => ({ id: customer.id, name: customer.name, phone: customer.phone, outstanding: customer.outstanding }))}
        />
      ) : null}
      <DataTable
        caption={ph("Advance report")}
        columns={[
          { key: "date", header: ph("Date"), cell: (row) => row.businessDate },
          { key: "customer", header: ph("Customer"), cell: (row) => row.customerName },
          { key: "method", header: ph("Method"), cell: (row) => row.method },
          { key: "amount", header: ph("Amount"), cell: (row) => row.amount },
        ]}
        rows={advances}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No advances")} description={ph("An advance stays separate from due collection.")} />}
      />
    </div>
  );
}
