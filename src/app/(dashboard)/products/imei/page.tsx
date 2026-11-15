import { redirect } from "next/navigation";

import { SerialForm } from "@/components/reference/gap-forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listSerialProducts } from "@/modules/catalog/flags";
import { listSerials } from "@/modules/reference/extras";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("IMEI / Serial");

export default async function ImeiPage() {
  const ph = await getPhrase();
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
        title={ph("IMEI / Serial")}
        description={ph("Save an IMEI on a product that tracks serial numbers. A sale of that product asks for one in-stock IMEI and marks it sold.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: ph("IMEI") }]}
      />
      {session.permissions.has("products.edit") ? (
        <SerialForm products={products.map((product) => ({ id: product.id, label: `${product.sku} · ${product.name}` }))} />
      ) : null}
      <DataTable
        caption={ph("IMEI numbers")}
        columns={[
          { key: "serial", header: ph("IMEI"), cell: (row) => row.serial },
          { key: "sku", header: ph("SKU"), cell: (row) => row.sku },
          { key: "name", header: ph("Product"), cell: (row) => row.name },
          { key: "status", header: ph("Status"), cell: (row) => row.status },
        ]}
        rows={serials}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No IMEI numbers")} description={ph("Turn on track serial, then save the number here.")} />}
      />
    </div>
  );
}
