import { redirect } from "next/navigation";

import { PartyAmountForm } from "@/components/customers/party-search";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listCustomerAdvances } from "@/modules/customers/advances";
import { listCustomers } from "@/modules/customers/customers";

export const metadata = { title: "Advance Receive" };

export default async function CustomerAdvancesPage() {
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
        title="Advance Receive"
        description="An advance is its own record. It can be more than the outstanding due, and it is not a wallet payment."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Customer Advance" }]}
      />
      {session.permissions.has("customers.advance") ? (
        <PartyAmountForm
          title="Advance Receive"
          url="/api/v1/customer-advances"
          mode="advance"
          parties={customers
            .filter((customer) => customer.status === "ACTIVE")
            .map((customer) => ({ id: customer.id, name: customer.name, phone: customer.phone, outstanding: customer.outstanding }))}
        />
      ) : null}
      <DataTable
        caption="Advance report"
        columns={[
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "customer", header: "Customer", cell: (row) => row.customerName },
          { key: "method", header: "Method", cell: (row) => row.method },
          { key: "amount", header: "Amount", cell: (row) => row.amount },
        ]}
        rows={advances}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No advances" description="An advance stays separate from due collection." />}
      />
    </div>
  );
}
