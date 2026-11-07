import { redirect } from "next/navigation";

import { DamageForm } from "@/components/inventory/stock-forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { listProducts } from "@/modules/catalog/products";
import { getSession } from "@/modules/auth/current-session";
import { listDamageRecords } from "@/modules/inventory/documents";

export const metadata = { title: "Damage Products" };

export default async function DamagePage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const [products, records] = await Promise.all([
    session.permissions.has("inventory.damage") ? listProducts(session.organizationId) : Promise.resolve([]),
    listDamageRecords(session.organizationId, session.branchId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Add Damage Product"
        description="One product is posted at a time. Discount and VAT amounts are stored as entered. They are not calculated."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Damage Products" }]}
      />
      <DamageForm products={products.map((product) => ({ id: product.id, label: `${product.sku} · ${product.name}` }))} />
      <h2 className="text-lg font-semibold">All Damage Products</h2>
      <DataTable
        caption="Damage products"
        columns={[
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "sku", header: "SKU", cell: (row) => row.sku },
          { key: "name", header: "Product", cell: (row) => row.name },
          { key: "place", header: "Place", cell: (row) => row.place },
          { key: "lot", header: "Lot", cell: (row) => row.lot },
          { key: "quantity", header: "Quantity", cell: (row) => row.quantity },
          { key: "reason", header: "Reason", cell: (row) => row.reason },
        ]}
        rows={records}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No damage" description="A posted damage line reduces stock and appears here." />}
      />
    </div>
  );
}
