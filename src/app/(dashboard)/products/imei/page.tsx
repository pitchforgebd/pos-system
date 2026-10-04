import { redirect } from "next/navigation";

import { SerialForm } from "@/components/reference/gap-forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listSerialProducts } from "@/modules/catalog/flags";
import { listSerials } from "@/modules/reference/extras";

export const metadata = { title: "IMEI / Serial" };

export default async function ImeiPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const [products, serials] = await Promise.all([
    listSerialProducts(session.organizationId),
    listSerials(session.organizationId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="IMEI / Serial"
        description="Save an IMEI on a product that tracks serial numbers. A sale of that product asks for one in-stock IMEI and marks it sold."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: "IMEI" }]}
      />
      {session.permissions.has("products.edit") ? (
        <SerialForm products={products.map((product) => ({ id: product.id, label: `${product.sku} · ${product.name}` }))} />
      ) : null}
      <DataTable
        caption="IMEI numbers"
        columns={[
          { key: "serial", header: "IMEI", cell: (row) => row.serial },
          { key: "sku", header: "SKU", cell: (row) => row.sku },
          { key: "name", header: "Product", cell: (row) => row.name },
          { key: "status", header: "Status", cell: (row) => row.status },
        ]}
        rows={serials}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No IMEI numbers" description="Turn on track serial, then save the number here." />}
      />
    </div>
  );
}
