import { notFound, redirect } from "next/navigation";

import { PurchaseActions } from "@/components/purchasing/purchase-actions";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { businessDate } from "@/core/time/business-date";
import { getSession } from "@/modules/auth/current-session";
import { moneyAccountOptions } from "@/modules/purchasing/lookups";
import { getPurchase } from "@/modules/purchasing/purchases";

export const metadata = { title: "Purchase" };

const TONE = { DRAFT: "neutral", ORDERED: "info", RECEIVED: "success", CANCELLED: "error" } as const;

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
        caption="Purchase lines"
        columns={[
          { key: "sku", header: "SKU", cell: (row) => row.sku },
          { key: "name", header: "Product", cell: (row) => row.name },
          { key: "quantity", header: "Quantity", cell: (row) => row.quantity },
          { key: "cost", header: "Unit cost", cell: (row) => row.unitCost },
          { key: "discount", header: "Discount", cell: (row) => row.discount },
          { key: "vat", header: "VAT", cell: (row) => (row.vatRate === "0.00" ? "" : `${row.vatRate}% = ${row.vatAmount}`) },
          { key: "total", header: "Line total", cell: (row) => row.lineTotal },
          { key: "landed", header: "Landed unit cost", cell: (row) => row.landedUnitCost ?? "" },
        ]}
        rows={purchase.items}
        getRowKey={(row) => row.id}
      />
      <dl className="grid max-w-md grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt>Goods</dt>
        <dd className="text-right tabular-nums">{purchase.subtotal}</dd>
        <dt>Discounts</dt>
        <dd className="text-right tabular-nums">{purchase.discountTotal}</dd>
        <dt>VAT</dt>
        <dd className="text-right tabular-nums">{purchase.vatTotal}</dd>
        <dt className="font-medium">Owed to {purchase.supplier.name}</dt>
        <dd className="text-right font-medium tabular-nums">{purchase.total}</dd>
        <dt>Haulage {purchase.transportCost}, other costs {purchase.otherCost}</dt>
        <dd className="text-right tabular-nums">{purchase.chargesTotal}</dd>
        <dt className="font-medium">Cost altogether</dt>
        <dd className="text-right font-medium tabular-nums">{purchase.landedTotal}</dd>
      </dl>
      {purchase.chargesTotal !== "0.00" ? (
        <p className="text-sm text-muted">
          Haulage {purchase.transportPaidWith === "CREDIT" ? `is owed to ${purchase.transporter?.name ?? "the carrier"}` : `was paid ${purchase.transportPaidWith === "BANK" ? "from the bank" : "in cash"}`}
          {purchase.transporter ? ` · carrier ${purchase.transporter.name}` : ""}
          {purchase.vehicleNo ? ` · vehicle ${purchase.vehicleNo}` : ""}.
        </p>
      ) : null}
      {purchase.status === "RECEIVED" ? (
        <p className="text-sm text-muted">
          Received {purchase.receivedOn} into {purchase.warehouse?.name ?? "the warehouse"}. Payment status {purchase.paymentStatus}: owed {purchase.owed}, paid since the purchase {purchase.paidLater}. Journal{" "}
          {purchase.journalBalanced ? "is balanced" : "is not balanced"}.
        </p>
      ) : (
        <p className="text-sm text-muted">Nothing is posted for this purchase until the goods are received.</p>
      )}
      {purchase.note ? <p className="text-sm">{purchase.note}</p> : null}
    </div>
  );
}
