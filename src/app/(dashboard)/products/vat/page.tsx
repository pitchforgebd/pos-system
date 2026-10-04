import { redirect } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listProductVat } from "@/modules/catalog/flags";

export const metadata = { title: "VAT" };

export default async function VatPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const rows = await listProductVat(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="VAT"
        description="VAT type and value are stored on the product. A sale adds exclusive VAT and extracts inclusive VAT from the shelf price."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: "VAT" }]}
      />
      <DataTable
        caption="Product VAT"
        columns={[
          { key: "sku", header: "SKU", cell: (row) => row.sku },
          { key: "name", header: "Product", cell: (row) => row.name },
          { key: "type", header: "VAT type", cell: (row) => row.vatType },
          { key: "value", header: "VAT value", cell: (row) => row.vatValue },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No products" description="Stored VAT fields appear here and are used when that product is sold." />}
      />
    </div>
  );
}
