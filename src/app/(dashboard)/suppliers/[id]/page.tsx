import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { VendorAdvanceForm, VendorApplyAdvanceForm, VendorPayForm } from "@/components/purchasing/vendor-forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { businessDate } from "@/core/time/business-date";
import { getSession } from "@/modules/auth/current-session";
import { moneyAccountOptions } from "@/modules/purchasing/lookups";
import { getVendorProfile } from "@/modules/purchasing/vendor-profile";

export const metadata = { title: "Supplier" };

const TONE = { PAID: "success", PARTIAL: "warning", UNPAID: "error" } as const;

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const { id } = await params;
  const supplier = await getVendorProfile(session.organizationId, id);
  if (!supplier) {
    notFound();
  }
  const canPay = session.permissions.has("suppliers.payment") && supplier.status === "ACTIVE";
  const accounts = canPay ? (await moneyAccountOptions(session.organizationId)).map((account) => ({ id: account.id, label: `${account.code} · ${account.name}`, kind: account.kind })) : [];
  const today = businessDate();
  const hasAdvance = supplier.advance !== "0.00";

  return (
    <div className="space-y-6">
      <PageHeader
        title={supplier.name}
        description={[supplier.phone, supplier.email, supplier.address, supplier.paymentTerms ? `terms: ${supplier.paymentTerms}` : null].filter(Boolean).join(" · ") || "No contact details"}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Suppliers", href: "/suppliers" }, { label: supplier.name }]}
        actions={supplier.status === "ACTIVE" ? <StatusBadge tone="success">Active</StatusBadge> : <StatusBadge>Inactive</StatusBadge>}
      />
      <dl className="grid max-w-2xl grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div>
          <dt className="text-muted">We owe</dt>
          <dd className="text-lg font-semibold tabular-nums">{supplier.outstanding}</dd>
        </div>
        <div>
          <dt className="text-muted">Held as advance</dt>
          <dd className="text-lg font-semibold tabular-nums">{supplier.advance}</dd>
        </div>
        <div>
          <dt className="text-muted">Credit limit</dt>
          <dd className="text-lg font-semibold tabular-nums">{supplier.creditLimit ?? "None"}</dd>
        </div>
        <div>
          <dt className="text-muted">Opening payable</dt>
          <dd className="text-lg font-semibold tabular-nums">{supplier.openingPayable}</dd>
        </div>
      </dl>

      {canPay ? (
        <section className="grid gap-4 lg:grid-cols-2" aria-label="Pay this vendor">
          <VendorPayForm supplierId={supplier.id} accounts={accounts} bills={supplier.openBills} today={today} />
          <div className="grid content-start gap-4">
            <VendorAdvanceForm supplierId={supplier.id} accounts={accounts} today={today} />
            {hasAdvance ? <VendorApplyAdvanceForm supplierId={supplier.id} bills={supplier.openBills} held={supplier.advance} today={today} /> : null}
          </div>
        </section>
      ) : null}

      <DataTable
        caption="Bills"
        columns={[
          { key: "number", header: "Purchase", cell: (row) => <Link href={`/purchases/${row.id}`}>{row.number ?? "Purchase"}</Link> },
          { key: "date", header: "Received", cell: (row) => row.businessDate },
          { key: "invoice", header: "Vendor's invoice", cell: (row) => row.supplierInvoiceNo ?? "" },
          { key: "total", header: "Bill", cell: (row) => row.total },
          { key: "owed", header: "Still owed", cell: (row) => row.owed },
          { key: "status", header: "Payment", cell: (row) => <StatusBadge tone={TONE[row.status]}>{row.status}</StatusBadge> },
        ]}
        rows={supplier.bills}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No bills" description="Received purchases from this vendor appear here." />}
      />
      <DataTable
        caption="Payments and advances used"
        columns={[
          { key: "number", header: "Receipt", cell: (row) => <Link href={`/suppliers/payments/${row.id}`}>{row.number ?? "Payment"}</Link> },
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "account", header: "Paid from", cell: (row) => row.account },
          { key: "amount", header: "Amount", cell: (row) => row.amount },
          { key: "charge", header: "Charge", cell: (row) => (row.charge === "0.00" ? "" : row.charge) },
        ]}
        rows={supplier.payments}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No payments" description="Payments to this vendor appear here." />}
      />
      {supplier.advances.length > 0 ? (
        <DataTable
          caption="Advances paid"
          columns={[
            { key: "number", header: "Number", cell: (row) => row.number ?? "Advance" },
            { key: "date", header: "Date", cell: (row) => row.businessDate },
            { key: "account", header: "Paid from", cell: (row) => row.account },
            { key: "amount", header: "Amount", cell: (row) => row.amount },
          ]}
          rows={supplier.advances}
          getRowKey={(row) => row.id}
        />
      ) : null}
      <DataTable
        caption="Supplier ledger"
        columns={[
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "type", header: "Type", cell: (row) => row.entryType },
          { key: "debit", header: "Debit", cell: (row) => row.debit },
          { key: "credit", header: "Credit", cell: (row) => row.credit },
        ]}
        rows={supplier.ledger}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No ledger rows" description="Purchases and payments will appear here." />}
      />
    </div>
  );
}
