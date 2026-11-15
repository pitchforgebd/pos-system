import { redirect } from "next/navigation";

import { NamedRecordForm } from "@/components/catalog/named-record-form";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { listBrands } from "@/modules/catalog/references";
import { getSession } from "@/modules/auth/current-session";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Brands");

export default async function BrandsPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const brands = await listBrands(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Brands")}
        description={ph("Brands in this organization.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: ph("Brands") }]}
      />
      {session.permissions.has("products.create") ? <NamedRecordForm action="/api/v1/brands" label={ph("Brand name")} /> : null}
      <DataTable
        caption={ph("Brands")}
        columns={[
          { key: "name", header: ph("Brand"), cell: (row) => row.name },
          { key: "products", header: ph("Products"), cell: (row) => row._count.products },
          { key: "status", header: ph("Status"), cell: (row) => row.status },
        ]}
        rows={brands}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No brands")} description={ph("Add a brand before assigning it to a product.")} />}
      />
    </div>
  );
}
