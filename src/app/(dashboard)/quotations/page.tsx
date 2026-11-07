import Link from "next/link";
import { redirect } from "next/navigation";

import { QuotationForm } from "@/components/commerce/forms";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listProducts } from "@/modules/catalog/products";
import { listQuotations } from "@/modules/commerce/quotations";
import { listCustomers } from "@/modules/customers/customers";

export const metadata = { title: "Quotation" };

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const params = await searchParams;
  const q = params.q?.trim().toLowerCase() ?? "";
  const [customers, quotations, products] = await Promise.all([
    listCustomers(session.organizationId),
    listQuotations(session.organizationId, session.branchId),
    listProducts(session.organizationId),
  ]);
  const rows = quotations.filter((row) => !q || `${row.number ?? ""} ${row.customerName}`.toLowerCase().includes(q));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Create Quotation"
        description="A quotation can store a product, a quantity, and a unit price. Convert turns those lines into a due sale."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Quotations" }]}
      />
      {session.permissions.has("quotations.manage") ? (
        <QuotationForm
          customers={customers.filter((customer) => customer.status === "ACTIVE").map((customer) => ({ id: customer.id, label: customer.name }))}
          products={products.filter((product) => product.status === "ACTIVE").map((product) => ({ id: product.id, label: `${product.sku} · ${product.name}` }))}
        />
      ) : null}
      <h2 className="text-lg font-semibold">All Quotation</h2>
      <form className="flex flex-wrap items-end gap-2" action="/quotations">
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          Search
          <input name="q" defaultValue={params.q ?? ""} placeholder="Number or customer" className="h-10 rounded-md border border-border px-3" />
        </label>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <DataTable
        caption="Quotations"
        columns={[
          { key: "number", header: "Quotation", cell: (row) => <Link href={`/quotations/${row.id}`}>{row.number}</Link> },
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "customer", header: "Customer", cell: (row) => row.customerName },
          { key: "lines", header: "Lines", cell: (row) => String(row.lineCount) },
          { key: "status", header: "Status", cell: (row) => row.status },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No quotations" description="A quotation is a draft until it is sent." />}
      />
    </div>
  );
}
