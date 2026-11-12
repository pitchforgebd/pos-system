import { redirect } from "next/navigation";

import { CollectForm } from "@/components/customers/collect-form";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { businessDate } from "@/core/time/business-date";
import { moneyAccountOptions } from "@/modules/purchasing/lookups";
import { listCustomerPayments } from "@/modules/customers/dues";

export const metadata = { title: "Take Payment" };

export default async function CustomerPaymentsPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const [payments, accounts] = await Promise.all([listCustomerPayments(session.organizationId, session.branchId), moneyAccountOptions(session.organizationId)]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Take Payment"
        description="Find the customer, see what they owe invoice by invoice, choose the invoices the money is for (or let it settle the oldest first), the account it came into and the bank or mobile charge."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Take Customer Due" }]}
      />
      {session.permissions.has("customers.payment") ? (
        <CollectForm today={businessDate()} accounts={accounts.map((account) => ({ id: account.id, label: `${account.code} · ${account.name}`, kind: account.kind }))} />
      ) : null}
      <DataTable
        caption="Payment vouchers"
        columns={[
          { key: "number", header: "Receipt", cell: (row) => row.number },
          { key: "date", header: "Date", cell: (row) => row.businessDate },
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
