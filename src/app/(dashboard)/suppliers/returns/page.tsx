import { redirect } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listPurchaseReturns } from "@/modules/purchasing/returns";

export const metadata = { title: "Supplier returns" };

export default async function SupplierReturnsPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const returns = await listPurchaseReturns(session.organizationId, session.branchId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier returns"
        description="Purchase returns for this branch."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Suppliers", href: "/suppliers" }, { label: "Returns" }]}
        actions={
          session.permissions.has("purchase.return") ? (
            <Button href="/purchases/returns" variant="secondary">
              New return
            </Button>
          ) : null
        }
      />
      <DataTable
        caption="Supplier returns"
        columns={[
          { key: "number", header: "Return", cell: (row) => row.number },
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "source", header: "Purchase", cell: (row) => row.source },
          { key: "supplier", header: "Supplier", cell: (row) => row.supplierName },
          { key: "total", header: "Total", cell: (row) => row.total },
        ]}
        rows={returns}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No supplier returns" description="A supplier return is posted from the purchase return screen." />}
      />
    </div>
  );
}
