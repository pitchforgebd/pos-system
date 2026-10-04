import { redirect } from "next/navigation";

import { WarehouseForm } from "@/components/access/warehouse-form";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db/client";
import { getSession } from "@/modules/auth/current-session";

export const metadata = { title: "Warehouses" };

export default async function WarehousesPage() {
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
        title="Warehouses"
        description="Super Admin adds a warehouse to a branch. Stock for a sale uses one active warehouse on that branch."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Warehouses" }]}
      />
      {session.permissions.has("branches.manage") ? <WarehouseForm branches={branches} /> : null}
      <DataTable
        caption="Warehouses"
        columns={[
          { key: "name", header: "Warehouse", cell: (row) => row.name },
          { key: "branch", header: "Branch", cell: (row) => row.branch.name },
          { key: "status", header: "Status", cell: (row) => row.status },
        ]}
        rows={warehouses}
        getRowKey={(row) => row.id}
      />
    </div>
  );
}
