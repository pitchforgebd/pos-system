import { notFound, redirect } from "next/navigation";

import { PurchaseActions } from "@/components/purchasing/purchase-actions";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { businessDate } from "@/core/time/business-date";
import { getSession } from "@/modules/auth/current-session";
import { moneyAccountOptions } from "@/modules/purchasing/lookups";
import { getPurchase } from "@/modules/purchasing/purchases";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Purchase");

const TONE = { DRAFT: "neutral", ORDERED: "info", RECEIVED: "success", CANCELLED: "error" } as const;

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const { id } = await params;
  const purchase = await getPurchase(session.organizationId, session.branchId, id);
  if (!purchase) {
    notFound();
  }
  const accounts = await moneyAccountOptions(session.organizationId);
  const title = purchase.number ?? "Draft purchase";

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={`${purchase.supplier.name} · bill of ${purchase.businessDate}${purchase.supplierInvoiceNo ? ` · vendor's invoice ${purchase.supplierInvoiceNo}` : ""}`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Purchases", href: "/purchases" }, { label: title }]}
        actions={<StatusBadge tone={TONE[purchase.status]}>{purchase.status}</StatusBadge>}
      />
      <PurchaseActions
        id={purchase.id}
        status={purchase.status}
        today={businessDate()}
        accounts={accounts.map((account) => ({ id: account.id, label: `${account.code} · ${account.name}`, kind: account.kind }))}
        can={{ create: session.permissions.has("purchase.create"), edit: session.permissions.has("purchase.edit"), return: session.permissions.has("purchase.return") }}
      />
      <DataTable
        caption={ph("Purchase lines")}
        columns={[
          { key: "sku", header: ph("SKU"), cell: (row) => row.sku },
          { key: "name", header: ph("Product"), cell: (row) => row.name },
          { key: "quantity", header: ph("Quantity"), cell: (row) => row.quantity },
          { key: "cost", header: ph("Unit cost"), cell: (row) => row.unitCost },
          { key: "discount", header: ph("Discount"), cell: (row) => row.discount },
          { key: "vat", header: ph("VAT"), cell: (row) => (row.vatRate === "0.00" ? "" : `${row.vatRate}% = ${row.vatAmount}`) },
          { key: "total", header: ph("Line total"), cell: (row) => row.lineTotal },
          { key: "landed", header: ph("Landed unit cost"), cell: (row) => row.landedUnitCost ?? "" },
        ]}
        rows={purchase.items}
        getRowKey={(row) => row.id}
      />
      <dl className="grid max-w-md grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt>{ph("Goods")}</dt>
        <dd className="text-right tabular-nums">{purchase.subtotal}</dd>
        <dt>{ph("Discounts")}</dt>
        <dd className="text-right tabular-nums">{purchase.discountTotal}</dd>
        <dt>{ph("VAT")}</dt>
        <dd className="text-right tabular-nums">{purchase.vatTotal}</dd>
        <dt className="font-medium">{ph("Owed to")} {purchase.supplier.name}</dt>
        <dd className="text-right font-medium tabular-nums">{purchase.total}</dd>
        <dt>{ph("Haulage")} {purchase.transportCost}{ph(", other costs")} {purchase.otherCost}</dt>
        <dd className="text-right tabular-nums">{purchase.chargesTotal}</dd>
        <dt className="font-medium">{ph("Cost altogether")}</dt>
        <dd className="text-right font-medium tabular-nums">{purchase.landedTotal}</dd>
      </dl>
      {purchase.chargesTotal !== "0.00" ? (
        <p className="text-sm text-muted">
          {ph("Haulage")} {purchase.transportPaidWith === "CREDIT" ? `is owed to ${purchase.transporter?.name ?? "the carrier"}` : `was paid ${purchase.transportPaidWith === "BANK" ? "from the bank" : "in cash"}`}
          {purchase.transporter ? ` · carrier ${purchase.transporter.name}` : ""}
          {purchase.vehicleNo ? ` · vehicle ${purchase.vehicleNo}` : ""}.
        </p>
      ) : null}
      {purchase.status === "RECEIVED" ? (
        <p className="text-sm text-muted">
          {ph("Received")} {purchase.receivedOn} {ph("into")} {purchase.warehouse?.name ?? ph("the warehouse")}{ph(". Payment status")} {purchase.paymentStatus}{ph(": owed")} {purchase.owed}{ph(", paid since the purchase")} {purchase.paidLater}{ph(". Journal")}{" "}
          {purchase.journalBalanced ? ph("is balanced") : ph("is not balanced")}.
        </p>
      ) : (
        <p className="text-sm text-muted">{ph("Nothing is posted for this purchase until the goods are received.")}</p>
      )}
      {purchase.note ? <p className="text-sm">{purchase.note}</p> : null}
    </div>
  );
}
