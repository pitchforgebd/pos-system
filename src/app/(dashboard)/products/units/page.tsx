import { redirect } from "next/navigation";

import { NamedRecordForm } from "@/components/catalog/named-record-form";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { listUnits } from "@/modules/catalog/references";
import { getSession } from "@/modules/auth/current-session";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Units");

export default async function UnitsPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const units = await listUnits(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Units")}
        description={ph("Units of measure for this organization.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: ph("Units") }]}
      />
      {session.permissions.has("products.create") ? <NamedRecordForm action="/api/v1/units" label={ph("Unit name")} /> : null}
      <DataTable
        caption={ph("Units")}
        columns={[
          { key: "name", header: ph("Unit"), cell: (row) => row.name },
          { key: "products", header: ph("Products"), cell: (row) => row._count.products },
          { key: "status", header: ph("Status"), cell: (row) => row.status },
        ]}
        rows={units}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No units")} description={ph("Add a unit such as piece or kilogram.")} />}
      />
    </div>
  );
}
