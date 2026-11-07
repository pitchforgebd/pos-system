import { redirect } from "next/navigation";

import { InboundForm } from "@/components/inventory/stock-forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { listProducts } from "@/modules/catalog/products";
import { getSession } from "@/modules/auth/current-session";
import { listOwnInvoices } from "@/modules/inventory/documents";

export const metadata = { title: "Own stock" };

export default async function OwnStockPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  if (!session.branchId) {
    redirect("/dashboard");
  }
  const [products, invoices] = await Promise.all([
    session.permissions.has("inventory.opening") ? listProducts(session.organizationId) : Promise.resolve([]),
    listOwnInvoices(session.organizationId, session.branchId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Own Stock"
        description="Uses the same permission as opening stock. The ledger type is OWN_STOCK."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Inventory", href: "/inventory" }, { label: "Own stock" }]}
      />
      <InboundForm
        action="/api/v1/inventory/own-stock"
        submitLabel="Post own stock"
        products={products.map((product) => ({ id: product.id, label: `${product.sku} · ${product.name}` }))}
      />
      <h2 className="text-lg font-semibold">Own Stock Invoices</h2>
      <DataTable
        caption="Own stock invoices"
        columns={[
          { key: "number", header: "Number", cell: (row) => row.number },
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "place", header: "Place", cell: (row) => row.warehouseName },
        ]}
        rows={invoices}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No own-stock invoices" description="A posted own-stock line creates an invoice here." />}
      />
    </div>
  );
}
