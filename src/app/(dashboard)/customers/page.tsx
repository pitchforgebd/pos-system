import Link from "next/link";
import { redirect } from "next/navigation";

import { TypeForm } from "@/components/customers/forms";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listCustomerTypes } from "@/modules/customers/customers";
import { findCustomers } from "@/modules/parties/directory";
import { geography } from "@/modules/parties/profile";

export const metadata = { title: "All Customers" };

type Params = { q?: string; district?: string; type?: string; due?: string; size?: string; page?: string };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const params = await searchParams;
  const q = params.q?.trim().slice(0, 100) ?? "";
  const districtId = Number(params.district) > 0 ? Number(params.district) : null;
  const typeId = /^[0-9a-f-]{36}$/i.test(params.type ?? "") ? (params.type as string) : null;
  const due = params.due === "YES" || params.due === "NO" ? params.due : null;
  const [found, types, geo] = await Promise.all([
    findCustomers(session.organizationId, { q, districtId, customerTypeId: typeId, due, page: Number(params.page) || 1, pageSize: Number(params.size) || 50 }),
    listCustomerTypes(session.organizationId),
    geography(),
  ]);

  function href(page: number) {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (districtId) query.set("district", String(districtId));
    if (typeId) query.set("type", typeId);
    if (due) query.set("due", due);
    if (found.pageSize !== 50) query.set("size", String(found.pageSize));
    if (page > 1) query.set("page", String(page));
    const text = query.toString();
    return text ? `/customers?${text}` : "/customers";
  }
  const start = found.total === 0 ? 0 : (found.page - 1) * found.pageSize + 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="All Customers"
        description="Search by name, phone, code or business name; filter by district, type and whether they owe. What a customer owes comes from the books."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Customers" }]}
        actions={session.permissions.has("customers.create") ? <Button href="/customers/new">Add New Customer</Button> : null}
      />
      <section className="rounded-2xl border border-border bg-surface p-4">
        <form className="grid gap-2 sm:grid-cols-[1fr_12rem_10rem_9rem_6rem_auto] sm:items-end" action="/customers">
          <label className="grid gap-1 text-sm">
            Search
            <input name="q" defaultValue={q} placeholder="Name, phone, code or business" className="h-10 rounded-md border border-border px-3" />
          </label>
          <label className="grid gap-1 text-sm">
            District
            <select name="district" defaultValue={districtId ? String(districtId) : ""} className="h-10 rounded-md border border-border bg-surface px-2">
              <option value="">All districts</option>
              {geo.districts.map((district) => (
                <option key={district.id} value={district.id}>
                  {district.name} ({district.bnName})
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Type
            <select name="type" defaultValue={typeId ?? ""} className="h-10 rounded-md border border-border bg-surface px-2">
              <option value="">All types</option>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Owes
            <select name="due" defaultValue={due ?? ""} className="h-10 rounded-md border border-border bg-surface px-2">
              <option value="">Anyone</option>
              <option value="YES">Owes something</option>
              <option value="NO">Owes nothing</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Show
            <select name="size" defaultValue={String(found.pageSize)} className="h-10 rounded-md border border-border bg-surface px-2">
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
          Showing {start}–{start === 0 ? 0 : start + found.rows.length - 1} of {found.total}
        </p>
        <div className="mt-3">
          <DataTable
            caption="Customers"
            columns={[
              { key: "code", header: "Code", cell: (row) => row.code },
              { key: "name", header: "Customer", cell: (row) => <Link href={`/customers/${row.id}`}>{row.name}</Link> },
              { key: "business", header: "Business", cell: (row) => row.businessName ?? "" },
              { key: "phone", header: "Phone", cell: (row) => row.phone ?? "" },
              { key: "district", header: "District", cell: (row) => row.district ?? "" },
              { key: "type", header: "Type", cell: (row) => row.type ?? "" },
              { key: "due", header: "Owes", cell: (row) => row.due },
              { key: "status", header: "Status", cell: (row) => (row.status === "ACTIVE" ? "" : "Inactive") },
            ]}
            rows={found.rows}
            getRowKey={(row) => row.id}
            empty={<EmptyState title="No customers" description="No customer matches, or none has been added yet." />}
          />
        </div>
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          {found.page > 1 ? (
            <Link href={href(found.page - 1)} className="rounded-md border border-border px-3 py-1.5">
              Previous
            </Link>
          ) : null}
          <span className="text-muted">
            {found.page} / {found.pageCount}
          </span>
          {found.page < found.pageCount ? (
            <Link href={href(found.page + 1)} className="rounded-md border border-border px-3 py-1.5">
              Next
            </Link>
          ) : null}
        </div>
      </section>
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold">Customer Types</h2>
        <p className="mt-1 text-sm text-muted">A type sets which price level the customer buys at (Settings, Price Levels).</p>
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
