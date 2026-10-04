import Link from "next/link";
import { redirect } from "next/navigation";

import { TypeForm } from "@/components/customers/forms";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listCustomers, listCustomerTypes } from "@/modules/customers/customers";

export const metadata = { title: "All Customers" };

function pageNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function pageSize(value: string | undefined) {
  const parsed = Number(value);
  return parsed === 25 || parsed === 50 || parsed === 100 || parsed === 200 ? parsed : 50;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; size?: string; page?: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const size = pageSize(params.size);
  const [customers, types] = await Promise.all([
    listCustomers(session.organizationId, q),
    listCustomerTypes(session.organizationId),
  ]);
  const pageCount = Math.max(1, Math.ceil(customers.length / size));
  const page = Math.min(pageNumber(params.page), pageCount);
  const start = customers.length === 0 ? 0 : (page - 1) * size;
  const rows = customers.slice(start, start + size);

  function href(nextPage: number) {
    const query = new URLSearchParams();
    if (q) {
      query.set("q", q);
    }
    if (size !== 50) {
      query.set("size", String(size));
    }
    if (nextPage > 1) {
      query.set("page", String(nextPage));
    }
    const text = query.toString();
    return text ? `/customers?${text}` : "/customers";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="All Customers"
        description="Outstanding due is debits minus credits on the customer ledger."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Customers" }]}
        actions={session.permissions.has("customers.create") ? <Button href="/customers/new">Add New Customer</Button> : null}
      />
      <section className="rounded-2xl border border-border bg-surface p-4">
        <form className="flex flex-wrap items-end gap-2" action="/customers">
          <label className="grid min-w-56 flex-1 gap-1 text-sm">
            Search
            <input name="q" defaultValue={q} placeholder="Name or phone" className="h-10 rounded-md border border-border px-3" />
          </label>
          <label className="grid gap-1 text-sm">
            Show
            <select name="size" defaultValue={String(size)} className="h-10 rounded-md border border-border bg-surface px-2">
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
          </label>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <p className="mt-3 text-sm text-muted">
          Showing {rows.length === 0 ? 0 : start + 1}–{start + rows.length} of {customers.length}
        </p>
        <div className="mt-3">
          <DataTable
            caption="Customers"
            columns={[
              { key: "name", header: "Customer", cell: (row) => <Link href={`/customers/${row.id}`}>{row.name}</Link> },
              { key: "phone", header: "Phone", cell: (row) => row.phone ?? "" },
              { key: "type", header: "Type", cell: (row) => row.typeName ?? "" },
              { key: "status", header: "Status", cell: (row) => row.status },
              { key: "due", header: "Due", cell: (row) => row.outstanding },
            ]}
            rows={rows}
            getRowKey={(row) => row.id}
            empty={<EmptyState title="No customers" description="Add a customer to start a ledger." />}
          />
        </div>
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          {page > 1 ? (
            <Link href={href(page - 1)} className="rounded-md border border-border px-3 py-1.5">
              Previous
            </Link>
          ) : null}
          <span className="text-muted">
            {page} / {pageCount}
          </span>
          {page < pageCount ? (
            <Link href={href(page + 1)} className="rounded-md border border-border px-3 py-1.5">
              Next
            </Link>
          ) : null}
        </div>
      </section>
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold">Customer Types</h2>
        <p className="mt-1 text-sm text-muted">A type is a label on the profile. It does not change a price.</p>
        <div className="mt-4">{session.permissions.has("customers.create") ? <TypeForm /> : null}</div>
        <div className="mt-4">
          <DataTable
            caption="Customer types"
            columns={[
              { key: "name", header: "Type", cell: (row) => row.name },
              { key: "status", header: "Status", cell: (row) => row.status },
            ]}
            rows={types}
            getRowKey={(row) => row.id}
            empty={<EmptyState title="No types" description="Add a type when a customer profile needs one." />}
          />
        </div>
      </section>
    </div>
  );
}
