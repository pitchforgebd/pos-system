import { redirect } from "next/navigation";

import { PartyAmountForm } from "@/components/customers/party-search";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listCustomers } from "@/modules/customers/customers";
import { listCustomerPayments } from "@/modules/customers/dues";

export const metadata = { title: "Take Payment" };

export default async function CustomerPaymentsPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const [customers, payments] = await Promise.all([
    listCustomers(session.organizationId),
    listCustomerPayments(session.organizationId, session.branchId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Take Payment"
        description="Search by name or phone. A collection cannot exceed the outstanding due, and it is not split across invoices."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Take Customer Due" }]}
      />
      {session.permissions.has("customers.payment") ? (
        <PartyAmountForm
          title="Take Payment"
          url="/api/v1/customer-payments"
          mode="due"
          parties={customers
            .filter((customer) => customer.status === "ACTIVE")
            .map((customer) => ({ id: customer.id, name: customer.name, phone: customer.phone, outstanding: customer.outstanding }))}
        />
      ) : null}
      <DataTable
        caption="Payment vouchers"
        columns={[
          { key: "number", header: "Receipt", cell: (row) => row.number },
          { key: "date", header: "Date", cell: (row) => row.occurredOn },
          { key: "customer", header: "Customer", cell: (row) => row.customerName },
          { key: "method", header: "Method", cell: (row) => row.method },
          { key: "amount", header: "Amount", cell: (row) => row.amount },
        ]}
        rows={payments}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No payment vouchers" description="A receipt appears after a due is collected." />}
      />
    </div>
  );
}
