import { redirect } from "next/navigation";

import { ClaimForm, CloseClaim } from "@/components/reference/gap-forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listWarrantyProducts } from "@/modules/catalog/flags";
import { listCustomers } from "@/modules/customers/customers";
import { listClaims } from "@/modules/reference/extras";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Warranty Claims");

export default async function WarrantyClaimsPage() {
  const ph = await getPhrase();
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
        title={ph("Warranty Claims")}
        description={ph("A claim stores the product, the customer, an optional IMEI, and a note. Closing it does not move stock or money.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: "Warranty", href: "/products/warranty" }, { label: ph("Claims") }]}
      />
      {session.permissions.has("products.edit") ? (
        <ClaimForm
          products={products.map((product) => ({ id: product.id, label: `${product.sku} · ${product.name}` }))}
          customers={customers.filter((customer) => customer.status === "ACTIVE").map((customer) => ({ id: customer.id, label: customer.name }))}
        />
      ) : null}
      <DataTable
        caption={ph("Claims")}
        columns={[
          { key: "product", header: ph("Product"), cell: (row) => row.productName },
          { key: "customer", header: ph("Customer"), cell: (row) => row.customerName },
          { key: "serial", header: ph("IMEI"), cell: (row) => row.serial },
          { key: "note", header: ph("Note"), cell: (row) => row.note },
          { key: "status", header: ph("Status"), cell: (row) => row.status },
          {
            key: "close",
            header: ph("Claim"),
            cell: (row) => (session.permissions.has("products.edit") && row.status === "OPEN" ? <CloseClaim id={row.id} /> : null),
          },
        ]}
        rows={claims}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No claims")} description={ph("File a claim against a product marked warranty available.")} />}
      />
    </div>
  );
}
