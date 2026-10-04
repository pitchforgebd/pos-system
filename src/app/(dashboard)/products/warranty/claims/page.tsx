import { redirect } from "next/navigation";

import { ClaimForm, CloseClaim } from "@/components/reference/gap-forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listWarrantyProducts } from "@/modules/catalog/flags";
import { listCustomers } from "@/modules/customers/customers";
import { listClaims } from "@/modules/reference/extras";

export const metadata = { title: "Warranty Claims" };

export default async function WarrantyClaimsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const [products, customers, claims] = await Promise.all([
    listWarrantyProducts(session.organizationId),
    listCustomers(session.organizationId),
    listClaims(session.organizationId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Warranty Claims"
        description="A claim stores the product, the customer, an optional IMEI, and a note. Closing it does not move stock or money."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: "Warranty", href: "/products/warranty" }, { label: "Claims" }]}
      />
      {session.permissions.has("products.edit") ? (
        <ClaimForm
          products={products.map((product) => ({ id: product.id, label: `${product.sku} · ${product.name}` }))}
          customers={customers.filter((customer) => customer.status === "ACTIVE").map((customer) => ({ id: customer.id, label: customer.name }))}
        />
      ) : null}
      <DataTable
        caption="Claims"
        columns={[
          { key: "product", header: "Product", cell: (row) => row.productName },
          { key: "customer", header: "Customer", cell: (row) => row.customerName },
          { key: "serial", header: "IMEI", cell: (row) => row.serial },
          { key: "note", header: "Note", cell: (row) => row.note },
          { key: "status", header: "Status", cell: (row) => row.status },
          {
            key: "close",
            header: "Claim",
            cell: (row) => (session.permissions.has("products.edit") && row.status === "OPEN" ? <CloseClaim id={row.id} /> : null),
          },
        ]}
        rows={claims}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No claims" description="File a claim against a product marked warranty available." />}
      />
    </div>
  );
}
