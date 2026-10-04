import { redirect } from "next/navigation";

import { NamedRecordForm } from "@/components/catalog/named-record-form";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { listBrands } from "@/modules/catalog/references";
import { getSession } from "@/modules/auth/current-session";

export const metadata = { title: "Brands" };

export default async function BrandsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const brands = await listBrands(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Brands"
        description="Brands in this organization."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: "Brands" }]}
      />
      {session.permissions.has("products.create") ? <NamedRecordForm action="/api/v1/brands" label="Brand name" /> : null}
      <DataTable
        caption="Brands"
        columns={[
          { key: "name", header: "Brand", cell: (row) => row.name },
          { key: "products", header: "Products", cell: (row) => row._count.products },
          { key: "status", header: "Status", cell: (row) => row.status },
        ]}
        rows={brands}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No brands" description="Add a brand before assigning it to a product." />}
      />
    </div>
  );
}
