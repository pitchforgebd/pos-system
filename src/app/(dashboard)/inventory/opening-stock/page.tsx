import { redirect } from "next/navigation";

import { OpeningImportForm } from "@/components/imports/forms";
import { InboundForm } from "@/components/inventory/stock-forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { listProducts } from "@/modules/catalog/products";
import { getSession } from "@/modules/auth/current-session";
import { listOpeningInvoices } from "@/modules/inventory/documents";

export const metadata = { title: "Opening stock" };

export default async function OpeningStockPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  if (!session.branchId) {
    redirect("/dashboard");
  }
  const [products, invoices] = await Promise.all([
    session.permissions.has("inventory.opening") ? listProducts(session.organizationId) : Promise.resolve([]),
    listOpeningInvoices(session.organizationId, session.branchId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Opening Stock"
        description="Stock the shop started with. Each line is a stock movement and one journal together (Dr Inventory / Cr Opening Balance Equity), valued at the unit cost entered."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Inventory", href: "/inventory" }, { label: "Opening stock" }]}
      />
      <InboundForm
        action="/api/v1/inventory/opening-stock"
        submitLabel="Post opening stock"
        products={products.map((product) => ({ id: product.id, label: `${product.sku} · ${product.name}` }))}
      />
      {session.permissions.has("inventory.opening") ? <OpeningImportForm /> : null}
      <h2 className="text-lg font-semibold">Opening Stock Invoices</h2>
      <DataTable
        caption="Opening stock invoices"
        columns={[
          { key: "number", header: "Number", cell: (row) => row.number },
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "place", header: "Place", cell: (row) => row.warehouseName },
        ]}
        rows={invoices}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No opening invoices" description="A posted opening stock line creates an invoice here." />}
      />
    </div>
  );
}
