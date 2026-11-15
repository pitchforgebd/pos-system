import { redirect } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listProductVat } from "@/modules/catalog/flags";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("VAT");

export default async function VatPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const rows = await listProductVat(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("VAT")}
        description={ph("VAT type and value are stored on the product. A sale adds exclusive VAT and extracts inclusive VAT from the shelf price.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: ph("VAT") }]}
      />
      <DataTable
        caption={ph("Product VAT")}
        columns={[
          { key: "sku", header: ph("SKU"), cell: (row) => row.sku },
          { key: "name", header: ph("Product"), cell: (row) => row.name },
          { key: "type", header: ph("VAT type"), cell: (row) => row.vatType },
          { key: "value", header: ph("VAT value"), cell: (row) => row.vatValue },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No products")} description={ph("Stored VAT fields appear here and are used when that product is sold.")} />}
      />
    </div>
  );
}
