import { redirect } from "next/navigation";

import { TransferForm } from "@/components/inventory/transfer-form";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/states";
import { listQuery } from "@/core/list";
import { listTransfers } from "@/modules/inventory/documents";
import { prisma } from "@/lib/db/client";
import { getSession } from "@/modules/auth/current-session";

export const metadata = { title: "Transfers" };

export default async function TransfersPage({ searchParams }: { searchParams: Promise<{ page?: string; pageSize?: string }> }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const params = await searchParams;
  const transfers = session.branchId ? await listTransfers(session.organizationId, session.branchId, listQuery({ page: params.page, pageSize: params.pageSize }, { sorts: { date: [{ id: "asc" }] }, defaultSort: "-date" })) : null;
  const [branches, products] = await Promise.all([
    prisma.branch.findMany({
      where: { organizationId: session.organizationId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        warehouses: { where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } },
      },
    }),
    prisma.product.findMany({
      where: { organizationId: session.organizationId, deletedAt: null, status: "ACTIVE" },
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, name: true, sku: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Product Transfer"
        description="Stock stays at the source until this receive. Receive posts the out and the in together. Nothing sits in transit."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Product Transfer" }]}
      />
      {session.permissions.has("inventory.transfer") ? <TransferForm branches={branches} products={products} /> : null}
      {transfers ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Transfers</h2>
          <DataTable
            caption="Transfers"
            columns={[
              { key: "number", header: "Number", cell: (row) => row.number },
              { key: "date", header: "Date", cell: (row) => row.date },
              { key: "direction", header: "", cell: (row) => (row.direction === "OUT" ? "Sent" : row.direction === "IN" ? "Received" : "Within the branch") },
              { key: "from", header: "From", cell: (row) => row.from },
              { key: "to", header: "To", cell: (row) => row.to },
              { key: "items", header: "Products", cell: (row) => row.items },
              { key: "value", header: "Value (avg cost)", cell: (row) => row.value },
            ]}
            rows={transfers.rows}
            getRowKey={(row) => row.id}
            empty={<EmptyState title="No transfers" description="A transfer that leaves or reaches this branch appears here." />}
          />
          <Pagination page={transfers.page.page} pageCount={transfers.page.pageCount} total={transfers.page.total} pageSize={transfers.page.pageSize} path="/inventory/transfers" />
        </section>
      ) : null}
    </div>
  );
}
