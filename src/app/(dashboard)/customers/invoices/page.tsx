import Link from "next/link";
import { redirect } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listCustomerInvoices } from "@/modules/customers/customers";

export const metadata = { title: "Customer invoices" };

export default async function CustomerInvoicesPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const invoices = await listCustomerInvoices(session.organizationId, session.branchId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer invoices"
        description="Invoices posted on this branch for a named customer."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Customers", href: "/customers" }, { label: "Invoices" }]}
      />
      <DataTable
        caption="Invoices"
        columns={[
          { key: "number", header: "Invoice", cell: (row) => <Link href={`/sales/${row.saleId}`}>{row.number}</Link> },
          { key: "date", header: "Date", cell: (row) => row.occurredOn },
          { key: "customer", header: "Customer", cell: (row) => row.customerName },
          { key: "status", header: "Status", cell: (row) => row.status },
          { key: "total", header: "Total", cell: (row) => row.total },
        ]}
        rows={invoices}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No customer invoices" description="A credit or named sale creates an invoice." />}
      />
    </div>
  );
}
