import { redirect } from "next/navigation";

import { ReturnForm } from "@/components/returns/return-form";
import { I18nBoundary, getPhrase } from "@/lib/i18n/server";
import { phraseTitled } from "@/lib/i18n/metadata";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listPurchaseReturns, listReturnablePurchaseLines } from "@/modules/purchasing/returns";

export const generateMetadata = phraseTitled("Purchase returns");

export default async function PurchaseReturnsPage() {
  const ph = await getPhrase();
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
        title={ph("Supplier return")}
        description={ph("Search a line of a received purchase. The vendor is credited what the line was billed (after discount, with VAT); the stock leaves at its average cost and the difference is Purchase Price Variance. Cash or bank is used only when the return is larger than the outstanding payable.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: ph("Purchases"), href: "/purchases" }, { label: ph("Returns") }]}
      />
      {session.permissions.has("purchase.return") ? (
        <I18nBoundary areas={["returns"]}>
          <ReturnForm lines={lines.map((line) => ({ documentId: line.purchaseId, itemId: line.itemId, label: line.label }))} kind="purchase" />
        </I18nBoundary>
      ) : null}
      <DataTable
        caption={ph("Purchase returns")}
        columns={[
          { key: "number", header: ph("Return"), cell: (row) => row.number },
          { key: "date", header: ph("Date"), cell: (row) => row.businessDate },
          { key: "source", header: ph("Purchase"), cell: (row) => row.source },
          { key: "supplier", header: ph("Supplier"), cell: (row) => row.supplierName },
          { key: "total", header: ph("Total"), cell: (row) => row.total },
          { key: "status", header: ph("Status"), cell: (row) => row.status },
        ]}
        rows={returns}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No purchase returns")} description={ph("Return a line of a received purchase. The quantity cannot exceed what is still eligible.")} />}
      />
    </div>
  );
}
