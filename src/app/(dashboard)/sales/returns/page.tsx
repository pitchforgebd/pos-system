import { redirect } from "next/navigation";

import { ReceiptlessReturnForm } from "@/components/returns/receiptless-form";
import { ReturnForm } from "@/components/returns/return-form";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { businessDate } from "@/core/time/business-date";
import { titled } from "@/lib/i18n/metadata";
import { getI18n, I18nBoundary } from "@/lib/i18n/server";
import { getSession } from "@/modules/auth/current-session";
import { moneyAccountOptions } from "@/modules/purchasing/lookups";
import { listReceiptlessReturns } from "@/modules/sales/receiptless";
import { listReturnableSaleLines, listSaleReturns } from "@/modules/sales/returns";

export const generateMetadata = titled("returns", "returns.listTitle");

export default async function SalesReturnsPage() {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const { t, taka, date } = await getI18n("returns", "sales");
  const [lines, returns, accounts, noInvoice] = await Promise.all([
    listReturnableSaleLines(session.organizationId, session.branchId),
    listSaleReturns(session.organizationId, session.branchId),
    moneyAccountOptions(session.organizationId),
    listReceiptlessReturns(session.organizationId, session.branchId),
  ]);
  const status = (value: string) => (value === "DRAFT" ? t("sales.DRAFT") : value === "POSTED" ? t("sales.POSTED") : value === "CANCELLED" ? t("sales.CANCELLED") : value);

  return (
    <I18nBoundary areas={["returns"]}>
      <div className="space-y-6">
        <PageHeader
          title={t("returns.saleTitle")}
          description={t("returns.saleDescription")}
          breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Sales", href: "/sales" }, { label: "Returns" }]}
        />
        {session.permissions.has("sales.return") ? <ReturnForm lines={lines.map((line) => ({ documentId: line.saleId, itemId: line.itemId, label: line.label }))} kind="sale" /> : null}
        {session.permissions.has("returns.without_invoice") ? <ReceiptlessReturnForm today={businessDate()} accounts={accounts.map((account) => ({ id: account.id, label: `${account.code} · ${account.name}`, kind: account.kind }))} /> : null}
        <h2 className="text-lg font-semibold">{t("returns.returnedHeading")}</h2>
        <DataTable
          caption={t("returns.returnedCaption")}
          columns={[
            { key: "number", header: t("returns.colReturn"), cell: (row) => row.number },
            { key: "date", header: t("returns.colDate"), cell: (row) => date(row.businessDate) },
            { key: "source", header: t("returns.colInvoice"), cell: (row) => row.source },
            { key: "total", header: t("returns.colTotal"), cell: (row) => taka(row.total) },
            { key: "status", header: t("returns.colStatus"), cell: (row) => status(row.status) },
          ]}
          rows={returns}
          getRowKey={(row) => row.id}
          empty={<EmptyState title={t("returns.emptyTitle")} description={t("returns.emptyBody")} />}
        />
        <h2 className="text-lg font-semibold">{t("returns.noInvoiceHeading")}</h2>
        <DataTable
          caption={t("returns.noInvoiceCaption")}
          columns={[
            { key: "number", header: t("returns.colReturn"), cell: (row) => row.number },
            { key: "date", header: t("returns.colDate"), cell: (row) => date(row.businessDate) },
            { key: "reason", header: t("returns.colReason"), cell: (row) => row.reason },
            { key: "refund", header: t("returns.colRefunded"), cell: (row) => taka(row.total) },
            { key: "method", header: t("returns.colMethod"), cell: (row) => row.refundMethod },
          ]}
          rows={noInvoice}
          getRowKey={(row) => row.id}
          empty={<EmptyState title={t("returns.noInvoiceEmptyTitle")} description={t("returns.noInvoiceEmptyBody")} />}
        />
      </div>
    </I18nBoundary>
  );
}
