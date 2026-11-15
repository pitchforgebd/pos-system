import Link from "next/link";
import { redirect } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listCustomerInvoices } from "@/modules/customers/customers";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Customer invoices");

export default async function CustomerInvoicesPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const invoices = await listCustomerInvoices(session.organizationId, session.branchId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Customer invoices")}
        description={ph("Invoices posted on this branch for a named customer.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Customers", href: "/customers" }, { label: ph("Invoices") }]}
      />
      <DataTable
        caption={ph("Invoices")}
        columns={[
          { key: "number", header: ph("Invoice"), cell: (row) => <Link href={`/sales/${row.saleId}`}>{row.number}</Link> },
          { key: "date", header: ph("Date"), cell: (row) => row.businessDate },
          { key: "customer", header: ph("Customer"), cell: (row) => row.customerName },
          { key: "status", header: ph("Status"), cell: (row) => row.status },
          { key: "total", header: ph("Total"), cell: (row) => row.total },
        ]}
        rows={invoices}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No customer invoices")} description={ph("A credit or named sale creates an invoice.")} />}
      />
    </div>
  );
}
