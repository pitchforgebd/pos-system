import Link from "next/link";
import { redirect } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listWarrantyProducts } from "@/modules/catalog/flags";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Warranty");

export default async function WarrantyPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const rows = await listWarrantyProducts(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("File New Claim")}
        description={ph("Warranty available is a flag on the product. File the claim on Warranty Claims.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: ph("Warranty") }]}
      />
      <p className="text-sm">
        <Link href="/products/warranty/claims">{ph("Warranty Claims")}</Link>
      </p>
      <DataTable
        caption={ph("Warranty products")}
        columns={[
          { key: "sku", header: ph("SKU"), cell: (row) => row.sku },
          { key: "name", header: ph("Product"), cell: (row) => row.name },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No warranty products")} description={ph("Products marked warranty available appear here. File a claim from Warranty Claims.")} />}
      />
    </div>
  );
}
