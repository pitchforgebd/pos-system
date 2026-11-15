import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { VendorForm } from "@/components/parties/party-forms";
import { VendorAdvanceForm, VendorApplyAdvanceForm, VendorPayForm } from "@/components/purchasing/vendor-forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { businessDate } from "@/core/time/business-date";
import { getSession } from "@/modules/auth/current-session";
import { moneyAccountOptions } from "@/modules/purchasing/lookups";
import { geography } from "@/modules/parties/profile";
import { getVendorProfile } from "@/modules/purchasing/vendor-profile";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Supplier");

const TONE = { PAID: "success", PARTIAL: "warning", UNPAID: "error" } as const;

export default async function SupplierDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const ph = await getPhrase();
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
  const editing = (await searchParams).edit === "1" && session.permissions.has("suppliers.edit");
  const places = editing ? await geography() : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={supplier.name}
        description={[supplier.code, supplier.contactPerson, supplier.phone, supplier.altPhone, supplier.place, supplier.address, supplier.paymentTerms ? `terms: ${supplier.paymentTerms}` : null].filter(Boolean).join(" · ")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Suppliers", href: "/suppliers" }, { label: supplier.name }]}
        actions={
          <>
            {supplier.status === "ACTIVE" ? <StatusBadge tone="success">{ph("Active")}</StatusBadge> : <StatusBadge>{ph("Inactive")}</StatusBadge>}
            <Link href={`/suppliers/${supplier.id}/statement`} className="text-sm font-medium text-primary">
              {ph("Statement")}
            </Link>
            {session.permissions.has("suppliers.edit") && !editing ? (
              <Link href={`/suppliers/${supplier.id}?edit=1`} className="text-sm font-medium text-primary">
                {ph("Edit")}
              </Link>
            ) : null}
          </>
        }
      />
      <dl className="grid max-w-2xl grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div>
          <dt className="text-muted">{ph("We owe")}</dt>
          <dd className="text-lg font-semibold tabular-nums">{supplier.outstanding}</dd>
        </div>
        <div>
          <dt className="text-muted">{ph("Held as advance")}</dt>
          <dd className="text-lg font-semibold tabular-nums">{supplier.advance}</dd>
        </div>
        <div>
          <dt className="text-muted">{ph("Credit limit")}</dt>
          <dd className="text-lg font-semibold tabular-nums">{supplier.creditLimit ?? ph("None")}</dd>
        </div>
        <div>
          <dt className="text-muted">{ph("Bought in all")}</dt>
          <dd className="text-lg font-semibold tabular-nums">{supplier.totalPurchases}</dd>
        </div>
      </dl>
      {supplier.bankDetails ? <p className="text-sm text-muted">{`Bank: ${supplier.bankDetails}`}</p> : null}
      {editing && places ? (
        <section className="space-y-3" aria-label={ph("Edit vendor")}>
          <h2 className="text-lg font-semibold">{ph("Edit")}</h2>
          <VendorForm places={places} initial={supplier} />
        </section>
      ) : null}

      {canPay ? (
        <section className="grid gap-4 lg:grid-cols-2" aria-label={ph("Pay this vendor")}>
          <VendorPayForm supplierId={supplier.id} accounts={accounts} bills={supplier.openBills} today={today} />
          <div className="grid content-start gap-4">
            <VendorAdvanceForm supplierId={supplier.id} accounts={accounts} today={today} />
            {hasAdvance ? <VendorApplyAdvanceForm supplierId={supplier.id} bills={supplier.openBills} held={supplier.advance} today={today} /> : null}
          </div>
        </section>
      ) : null}

      <DataTable
        caption={ph("Bills")}
        columns={[
          { key: "number", header: ph("Purchase"), cell: (row) => <Link href={`/purchases/${row.id}`}>{row.number ?? ph("Purchase")}</Link> },
          { key: "date", header: ph("Received"), cell: (row) => row.businessDate },
          { key: "invoice", header: ph("Vendor's invoice"), cell: (row) => row.supplierInvoiceNo ?? "" },
          { key: "total", header: ph("Bill"), cell: (row) => row.total },
          { key: "owed", header: ph("Still owed"), cell: (row) => row.owed },
          { key: "status", header: ph("Payment"), cell: (row) => <StatusBadge tone={TONE[row.status]}>{row.status}</StatusBadge> },
        ]}
        rows={supplier.bills}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No bills")} description={ph("Received purchases from this vendor appear here.")} />}
      />
      <DataTable
        caption={ph("Payments and advances used")}
        columns={[
          { key: "number", header: ph("Receipt"), cell: (row) => <Link href={`/suppliers/payments/${row.id}`}>{row.number ?? ph("Payment")}</Link> },
          { key: "date", header: ph("Date"), cell: (row) => row.businessDate },
          { key: "account", header: ph("Paid from"), cell: (row) => row.account },
          { key: "amount", header: ph("Amount"), cell: (row) => row.amount },
          { key: "charge", header: ph("Charge"), cell: (row) => (row.charge === "0.00" ? "" : row.charge) },
        ]}
        rows={supplier.payments}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No payments")} description={ph("Payments to this vendor appear here.")} />}
      />
      {supplier.returns.length > 0 ? (
        <DataTable
          caption={ph("Returns to the vendor")}
          columns={[
            { key: "number", header: ph("Return"), cell: (row) => row.number ?? "Return" },
            { key: "date", header: ph("Date"), cell: (row) => row.businessDate },
            { key: "purchase", header: ph("Of purchase"), cell: (row) => <Link href={`/purchases/${row.purchaseId}`}>{ph("Open")}</Link> },
            { key: "total", header: ph("Total"), cell: (row) => row.total },
          ]}
          rows={supplier.returns}
          getRowKey={(row) => row.id}
        />
      ) : null}
      {supplier.advances.length > 0 ? (
        <DataTable
          caption={ph("Advances paid")}
          columns={[
            { key: "number", header: ph("Number"), cell: (row) => row.number ?? "Advance" },
            { key: "date", header: ph("Date"), cell: (row) => row.businessDate },
            { key: "account", header: ph("Paid from"), cell: (row) => row.account },
            { key: "amount", header: ph("Amount"), cell: (row) => row.amount },
          ]}
          rows={supplier.advances}
          getRowKey={(row) => row.id}
        />
      ) : null}
      <DataTable
        caption={ph("Supplier ledger")}
        columns={[
          { key: "date", header: ph("Date"), cell: (row) => row.businessDate },
          { key: "type", header: ph("Type"), cell: (row) => row.entryType },
          { key: "debit", header: ph("Debit"), cell: (row) => row.debit },
          { key: "credit", header: ph("Credit"), cell: (row) => row.credit },
        ]}
        rows={supplier.ledger}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No ledger rows")} description={ph("Purchases and payments will appear here.")} />}
      />
    </div>
  );
}
