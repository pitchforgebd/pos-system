import { redirect } from "next/navigation";

import { ReceiptlessReturnForm } from "@/components/returns/receiptless-form";
import { ReturnForm } from "@/components/returns/return-form";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { businessDate } from "@/core/time/business-date";
import { moneyAccountOptions } from "@/modules/purchasing/lookups";
import { listReceiptlessReturns } from "@/modules/sales/receiptless";
import { listReturnableSaleLines, listSaleReturns } from "@/modules/sales/returns";

export const metadata = { title: "Sales returns" };

export default async function SalesReturnsPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const [lines, returns, accounts, noInvoice] = await Promise.all([
    listReturnableSaleLines(session.organizationId, session.branchId),
    listSaleReturns(session.organizationId, session.branchId),
    moneyAccountOptions(session.organizationId),
    listReceiptlessReturns(session.organizationId, session.branchId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Returnable Product"
        description="Return a line of a posted sale: the money goes back the way the customer paid (or to their advance), and the stock into the lots it came from. A return with no invoice needs a permission and a manager's approval."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Sales", href: "/sales" }, { label: "Returns" }]}
      />
      {session.permissions.has("sales.return") ? (
        <>
          <ReturnForm lines={lines.map((line) => ({ documentId: line.saleId, itemId: line.itemId, label: line.label }))} kind="sale" />
        </>
      ) : null}
      {session.permissions.has("returns.without_invoice") ? <ReceiptlessReturnForm today={businessDate()} accounts={accounts.map((account) => ({ id: account.id, label: `${account.code} · ${account.name}`, kind: account.kind }))} /> : null}
      <h2 className="text-lg font-semibold">Returned Invoice</h2>
      <DataTable
        caption="Returned invoices"
        columns={[
          { key: "number", header: "Return", cell: (row) => row.number },
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "source", header: "Invoice", cell: (row) => row.source },
          { key: "total", header: "Total", cell: (row) => row.total },
          { key: "status", header: "Status", cell: (row) => row.status },
        ]}
        rows={returns}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No sales returns" description="Return a posted sale line. The quantity cannot exceed what is still eligible." />}
      />
      <h2 className="text-lg font-semibold">Returns with no invoice</h2>
      <DataTable
        caption="Returns with no invoice"
        columns={[
          { key: "number", header: "Return", cell: (row) => row.number },
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "reason", header: "Reason", cell: (row) => row.reason },
          { key: "refund", header: "Refunded", cell: (row) => row.total },
          { key: "method", header: "Method", cell: (row) => row.refundMethod },
        ]}
        rows={noInvoice}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No returns without an invoice" description="They need the returns.without_invoice permission and a manager's approval." />}
      />
    </div>
  );
}
