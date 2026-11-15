import { redirect } from "next/navigation";

import { DamageForm } from "@/components/inventory/stock-forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { listProducts } from "@/modules/catalog/products";
import { getSession } from "@/modules/auth/current-session";
import { listDamageRecords } from "@/modules/inventory/documents";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Damage Products");

export default async function DamagePage() {
  const ph = await getPhrase();
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
        title={ph("Add Damage Product")}
        description={ph("One product is posted at a time. Discount and VAT amounts are stored as entered. They are not calculated.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: ph("Damage Products") }]}
      />
      <DamageForm products={products.map((product) => ({ id: product.id, label: `${product.sku} · ${product.name}` }))} />
      <h2 className="text-lg font-semibold">{ph("All Damage Products")}</h2>
      <DataTable
        caption={ph("Damage products")}
        columns={[
          { key: "date", header: ph("Date"), cell: (row) => row.businessDate },
          { key: "sku", header: ph("SKU"), cell: (row) => row.sku },
          { key: "name", header: ph("Product"), cell: (row) => row.name },
          { key: "place", header: ph("Place"), cell: (row) => row.place },
          { key: "lot", header: ph("Lot"), cell: (row) => row.lot },
          { key: "quantity", header: ph("Quantity"), cell: (row) => row.quantity },
          { key: "reason", header: ph("Reason"), cell: (row) => row.reason },
        ]}
        rows={records}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No damage")} description={ph("A posted damage line reduces stock and appears here.")} />}
      />
    </div>
  );
}
