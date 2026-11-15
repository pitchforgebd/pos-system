import { redirect } from "next/navigation";

import { WarehouseForm } from "@/components/access/warehouse-form";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db/client";
import { getSession } from "@/modules/auth/current-session";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Warehouses");

export default async function WarehousesPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const [warehouses, branches] = await Promise.all([
    prisma.warehouse.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, status: true, branch: { select: { name: true } } },
    }),
    prisma.branch.findMany({
      where: { organizationId: session.organizationId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Warehouses")}
        description={ph("Super Admin adds a warehouse to a branch. Stock for a sale uses one active warehouse on that branch.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: ph("Warehouses") }]}
      />
      {session.permissions.has("branches.manage") ? <WarehouseForm branches={branches} /> : null}
      <DataTable
        caption={ph("Warehouses")}
        columns={[
          { key: "name", header: ph("Warehouse"), cell: (row) => row.name },
          { key: "branch", header: ph("Branch"), cell: (row) => row.branch.name },
          { key: "status", header: ph("Status"), cell: (row) => row.status },
        ]}
        rows={warehouses}
        getRowKey={(row) => row.id}
      />
    </div>
  );
}
