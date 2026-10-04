import { redirect } from "next/navigation";

import { NamedRecordForm } from "@/components/catalog/named-record-form";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { listUnits } from "@/modules/catalog/references";
import { getSession } from "@/modules/auth/current-session";

export const metadata = { title: "Units" };

export default async function UnitsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const units = await listUnits(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Units"
        description="Units of measure for this organization."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Products", href: "/products" }, { label: "Units" }]}
      />
      {session.permissions.has("products.create") ? <NamedRecordForm action="/api/v1/units" label="Unit name" /> : null}
      <DataTable
        caption="Units"
        columns={[
          { key: "name", header: "Unit", cell: (row) => row.name },
          { key: "products", header: "Products", cell: (row) => row._count.products },
          { key: "status", header: "Status", cell: (row) => row.status },
        ]}
        rows={units}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No units" description="Add a unit such as piece or kilogram." />}
      />
    </div>
  );
}
