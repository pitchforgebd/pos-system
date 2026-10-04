import Link from "next/link";
import { redirect } from "next/navigation";

import { CloseReminder, InstallmentForm } from "@/components/customers/forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listCustomerInvoices, listCustomers } from "@/modules/customers/customers";
import { listInstallments } from "@/modules/customers/installments";

export const metadata = { title: "Installment Reminders" };

export default async function InstallmentsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const params = await searchParams;
  const view = params.view === "overdue" || params.view === "open" ? params.view : "all";
  const [customers, invoices, installments] = await Promise.all([
    listCustomers(session.organizationId),
    listCustomerInvoices(session.organizationId, session.branchId),
    listInstallments(session.organizationId),
  ]);
  const rows = installments.filter((row) => (view === "all" ? true : row.displayStatus === (view === "overdue" ? "OVERDUE" : "OPEN")));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Installment Reminders"
        description="A reminder tracks an amount and a due date. Enter an interest percent to show the interest. Closing the reminder does not collect money."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Customers", href: "/customers" }, { label: "Installments" }]}
      />
      {session.permissions.has("customers.edit") ? (
        <InstallmentForm
          customers={customers.filter((customer) => customer.status === "ACTIVE").map((customer) => ({ id: customer.id, label: customer.name }))}
          invoices={invoices
            .filter((invoice) => invoice.status === "POSTED")
            .map((invoice) => ({ id: invoice.id, customerId: invoice.customerId, label: `${invoice.number} · ${invoice.total}` }))}
        />
      ) : null}
      <div className="flex gap-2 text-sm">
        <Link href="/customers/installments" className={view === "all" ? "font-semibold" : "text-muted"}>
          All
        </Link>
        <Link href="/customers/installments?view=open" className={view === "open" ? "font-semibold" : "text-muted"}>
          Open
        </Link>
        <Link href="/customers/installments?view=overdue" className={view === "overdue" ? "font-semibold" : "text-muted"}>
          Overdue
        </Link>
      </div>
      <DataTable
        caption="Reminders"
        columns={[
          { key: "invoice", header: "Invoice", cell: (row) => row.invoiceNumber },
          { key: "customer", header: "Customer", cell: (row) => row.customerName },
          { key: "due", header: "Due date", cell: (row) => row.dueOn },
          { key: "amount", header: "Amount", cell: (row) => row.amount },
          { key: "interest", header: "Interest %", cell: (row) => row.interestPercent },
          { key: "interestAmount", header: "Interest", cell: (row) => row.interestAmount },
          { key: "status", header: "Status", cell: (row) => row.displayStatus },
          {
            key: "close",
            header: "Reminder",
            cell: (row) => (session.permissions.has("customers.edit") && row.status === "OPEN" ? <CloseReminder id={row.id} /> : null),
          },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No reminders" description="Add a reminder against a posted customer invoice." />}
      />
    </div>
  );
}
