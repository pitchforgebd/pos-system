import Link from "next/link";
import { redirect } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listWarrantyProducts } from "@/modules/catalog/flags";

export const metadata = { title: "Warranty" };

export default async function WarrantyPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const rows = await listWarrantyProducts(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="File New Claim"
        description="Warranty available is a flag on the product. File the claim on Warranty Claims."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: "Warranty" }]}
      />
      <p className="text-sm">
        <Link href="/products/warranty/claims">Warranty Claims</Link>
      </p>
      <DataTable
        caption="Warranty products"
        columns={[
          { key: "sku", header: "SKU", cell: (row) => row.sku },
          { key: "name", header: "Product", cell: (row) => row.name },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No warranty products" description="Products marked warranty available appear here. File a claim from Warranty Claims." />}
      />
    </div>
  );
}
