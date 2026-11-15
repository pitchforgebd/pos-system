import { redirect } from "next/navigation";

import { RackForm } from "@/components/access/rack-form";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db/client";
import { getSession } from "@/modules/auth/current-session";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Racks");

export default async function RacksPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const [racks, warehouses] = await Promise.all([
    prisma.rack.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, status: true, warehouse: { select: { name: true } } },
    }),
    prisma.warehouse.findMany({
      where: { organizationId: session.organizationId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Racks")}
        description={ph("A rack is a place inside a warehouse. It does not move stock by itself.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: ph("Racks") }]}
      />
      {session.permissions.has("branches.manage") ? <RackForm warehouses={warehouses} /> : null}
      <DataTable
        caption={ph("Racks")}
        columns={[
          { key: "name", header: ph("Rack"), cell: (row) => row.name },
          { key: "warehouse", header: ph("Warehouse"), cell: (row) => row.warehouse.name },
          { key: "status", header: ph("Status"), cell: (row) => row.status },
        ]}
        rows={racks}
        getRowKey={(row) => row.id}
      />
    </div>
  );
}
