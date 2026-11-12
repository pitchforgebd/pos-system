import { redirect } from "next/navigation";

import { ReturnForm } from "@/components/returns/return-form";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listPurchaseReturns, listReturnablePurchaseLines } from "@/modules/purchasing/returns";

export const metadata = { title: "Purchase returns" };

export default async function PurchaseReturnsPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const [lines, returns] = await Promise.all([
    listReturnablePurchaseLines(session.organizationId, session.branchId),
    listPurchaseReturns(session.organizationId, session.branchId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier return"
        description="Search a line of a received purchase. The vendor is credited what the line was billed (after discount, with VAT); the stock leaves at its average cost and the difference is Purchase Price Variance. Cash or bank is used only when the return is larger than the outstanding payable."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Purchases", href: "/purchases" }, { label: "Returns" }]}
      />
      {session.permissions.has("purchase.return") ? (
        <ReturnForm lines={lines.map((line) => ({ documentId: line.purchaseId, itemId: line.itemId, label: line.label }))} kind="purchase" />
      ) : null}
      <DataTable
        caption="Purchase returns"
        columns={[
          { key: "number", header: "Return", cell: (row) => row.number },
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "source", header: "Purchase", cell: (row) => row.source },
          { key: "supplier", header: "Supplier", cell: (row) => row.supplierName },
          { key: "total", header: "Total", cell: (row) => row.total },
          { key: "status", header: "Status", cell: (row) => row.status },
        ]}
        rows={returns}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No purchase returns" description="Return a line of a received purchase. The quantity cannot exceed what is still eligible." />}
      />
    </div>
  );
}
