import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CustomerForm } from "@/components/parties/party-forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { getSession } from "@/modules/auth/current-session";
import { listCustomerTypes } from "@/modules/customers/customers";
import { getCustomerProfile } from "@/modules/customers/profile";
import { geography } from "@/modules/parties/profile";

export const metadata = { title: "Customer" };

const TONE = { PAID: "success", PARTIAL: "warning", UNPAID: "error" } as const;
const SMS_TONE: Record<string, "success" | "warning" | "error" | "neutral"> = { SENT: "success", QUEUED: "warning", SENDING: "warning", FAILED: "error" };

export default async function CustomerDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const { id } = await params;
  const customer = /^[0-9a-f-]{36}$/i.test(id) ? await getCustomerProfile(session.organizationId, id) : null;
  if (!customer) {
    notFound();
  }
  const editing = (await searchParams).edit === "1" && session.permissions.has("customers.edit") && !customer.isSystem;
  const [types, places] = editing ? await Promise.all([listCustomerTypes(session.organizationId), geography()]) : [[], null];
  const contact = [customer.phone, customer.altPhone, customer.place, customer.address].filter(Boolean).join(" · ");

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${customer.name}${customer.businessName ? ` · ${customer.businessName}` : ""}`}
        description={`${customer.code}${customer.type ? ` · ${customer.type}` : ""}${contact ? ` · ${contact}` : ""}`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Customers", href: "/customers" }, { label: customer.name }]}
        actions={
          <>
            {customer.status === "ACTIVE" ? <StatusBadge tone="success">Active</StatusBadge> : <StatusBadge>Inactive</StatusBadge>}
            {customer.smsOptOut ? <StatusBadge>No offer SMS</StatusBadge> : null}
            <Link href={`/customers/${customer.id}/statement`} className="text-sm font-medium text-primary">
              Statement
            </Link>
            {session.permissions.has("customers.edit") && !customer.isSystem && !editing ? (
              <Link href={`/customers/${customer.id}?edit=1`} className="text-sm font-medium text-primary">
                Edit
              </Link>
            ) : null}
          </>
        }
      />
      <dl className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <Figure label="Owes" value={customer.summary.due} />
        <Figure label="Held for them" value={customer.summary.advance} />
        <Figure label="Bought in all" value={customer.summary.bought} />
        <Figure label="Invoices" value={String(customer.summary.invoices)} />
        <Figure label="Last bought" value={customer.summary.lastPurchase ?? "Never"} />
        <Figure label="Credit limit" value={customer.creditLimit ?? "None"} />
      </dl>
      {customer.tags ? <p className="text-sm text-muted">{`Tags: ${customer.tags}`}</p> : null}

      {editing && places ? (
        <section className="space-y-3" aria-label="Edit customer">
          <h2 className="text-lg font-semibold">Edit</h2>
          <CustomerForm
            types={types.filter((type) => type.status === "ACTIVE" || type.id === customer.customerTypeId).map((type) => ({ id: type.id, label: type.name }))}
            places={places}
            initial={customer}
          />
        </section>
      ) : null}

      <DataTable
        caption="Invoices"
        columns={[
          { key: "number", header: "Invoice", cell: (row) => <Link href={`/sales/${row.id}`}>{row.number ?? "Invoice"}</Link> },
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "branch", header: "Branch", cell: (row) => row.branch },
          { key: "total", header: "Total", cell: (row) => row.total },
          { key: "owed", header: "Still owed", cell: (row) => row.owed },
          { key: "status", header: "Payment", cell: (row) => <StatusBadge tone={TONE[row.status]}>{row.status}</StatusBadge> },
        ]}
        rows={customer.invoices}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No invoices" description="Sales to this customer appear here." />}
      />
      {customer.returns.length > 0 ? (
        <DataTable
          caption="Returns"
          columns={[
            { key: "number", header: "Return", cell: (row) => row.number ?? "Return" },
            { key: "date", header: "Date", cell: (row) => row.businessDate },
            { key: "sale", header: "Of invoice", cell: (row) => <Link href={`/sales/${row.saleId}`}>Open</Link> },
            { key: "total", header: "Total", cell: (row) => row.total },
          ]}
          rows={customer.returns}
          getRowKey={(row) => row.id}
        />
      ) : null}
      {customer.orders.length > 0 ? (
        <DataTable
          caption="Orders and quotations"
          columns={[
            { key: "number", header: "Order", cell: (row) => <Link href={`/orders/${row.id}`}>{row.number ?? (row.quotation ? "Quotation" : "Draft")}</Link> },
            { key: "date", header: "Date", cell: (row) => row.businessDate },
            { key: "status", header: "Status", cell: (row) => (row.quotation ? "Quotation" : row.status) },
            { key: "total", header: "Total", cell: (row) => row.total },
          ]}
          rows={customer.orders}
          getRowKey={(row) => row.id}
        />
      ) : null}
      <DataTable
        caption="SMS sent"
        columns={[
          { key: "at", header: "When", cell: (row) => row.at.slice(0, 16).replace("T", " ") },
          { key: "campaign", header: "Campaign", cell: (row) => row.campaign ?? "" },
          { key: "body", header: "Message", cell: (row) => row.body },
          { key: "status", header: "Status", cell: (row) => <StatusBadge tone={SMS_TONE[row.status] ?? "neutral"}>{row.status}</StatusBadge> },
        ]}
        rows={customer.messages}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No SMS" description="Messages sent to this customer appear here." />}
      />
      <DataTable
        caption="Ledger (latest)"
        columns={[
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "type", header: "Entry", cell: (row) => row.entryType },
          { key: "debit", header: "Debit", cell: (row) => row.debit },
          { key: "credit", header: "Credit", cell: (row) => row.credit },
        ]}
        rows={customer.ledger}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No ledger lines" description="A sale, a payment, a return or an advance writes a line." />}
      />
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
