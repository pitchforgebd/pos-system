import { redirect } from "next/navigation";

import { CollectForm } from "@/components/customers/collect-form";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { businessDate } from "@/core/time/business-date";
import { moneyAccountOptions } from "@/modules/purchasing/lookups";
import { listCustomerPayments } from "@/modules/customers/dues";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Take Payment");

export default async function CustomerPaymentsPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const [payments, accounts] = await Promise.all([listCustomerPayments(session.organizationId, session.branchId), moneyAccountOptions(session.organizationId)]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Take Payment")}
        description={ph("Find the customer, see what they owe invoice by invoice, choose the invoices the money is for (or let it settle the oldest first), the account it came into and the bank or mobile charge.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: ph("Take Customer Due") }]}
      />
      {session.permissions.has("customers.payment") ? (
        <CollectForm today={businessDate()} accounts={accounts.map((account) => ({ id: account.id, label: `${account.code} · ${account.name}`, kind: account.kind }))} />
      ) : null}
      <DataTable
        caption={ph("Payment vouchers")}
        columns={[
          { key: "number", header: ph("Receipt"), cell: (row) => row.number },
          { key: "date", header: ph("Date"), cell: (row) => row.businessDate },
          { key: "customer", header: ph("Customer"), cell: (row) => row.customerName },
          { key: "method", header: ph("Method"), cell: (row) => row.method },
          { key: "amount", header: ph("Amount"), cell: (row) => row.amount },
        ]}
        rows={payments}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No payment vouchers")} description={ph("A receipt appears after a due is collected.")} />}
      />
    </div>
  );
}
