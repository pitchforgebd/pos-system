import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { findVendors } from "@/modules/parties/directory";
import { geography } from "@/modules/parties/profile";

export const metadata = { title: "Suppliers" };

type Params = { q?: string; district?: string; due?: string; size?: string; page?: string };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const params = await searchParams;
  const q = params.q?.trim().slice(0, 100) ?? "";
  const districtId = Number(params.district) > 0 ? Number(params.district) : null;
  const due = params.due === "YES" || params.due === "NO" ? params.due : null;
  const [found, geo] = await Promise.all([findVendors(session.organizationId, { q, districtId, due, page: Number(params.page) || 1, pageSize: Number(params.size) || 50 }), geography()]);

  function href(page: number) {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (districtId) query.set("district", String(districtId));
    if (due) query.set("due", due);
    if (found.pageSize !== 50) query.set("size", String(found.pageSize));
    if (page > 1) query.set("page", String(page));
    const text = query.toString();
    return text ? `/suppliers?${text}` : "/suppliers";
  }
  const start = found.total === 0 ? 0 : (found.page - 1) * found.pageSize + 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppliers"
        description="Search by name, phone, code or contact person; filter by district and whether the shop owes them. What is owed comes from the books."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Suppliers" }]}
        actions={
          <>
            {session.permissions.has("suppliers.create") ? <Button href="/suppliers/new">Add supplier</Button> : null}
            {session.permissions.has("suppliers.payment") ? (
              <Button href="/suppliers/payments" variant="secondary">
                Payment
              </Button>
            ) : null}
          </>
        }
      />
      <form className="grid gap-2 sm:grid-cols-[1fr_12rem_10rem_6rem_auto] sm:items-end" action="/suppliers">
        <label className="grid gap-1 text-sm">
          Search
          <input name="q" defaultValue={q} placeholder="Name, phone, code or contact" className="h-10 rounded-md border border-border px-3" />
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
          The shop owes
          <select name="due" defaultValue={due ?? ""} className="h-10 rounded-md border border-border bg-surface px-2">
            <option value="">Any</option>
            <option value="YES">Something</option>
            <option value="NO">Nothing</option>
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
      <p className="text-sm text-muted">
        Showing {start}–{start === 0 ? 0 : start + found.rows.length - 1} of {found.total}
      </p>
      <DataTable
        caption="Suppliers"
        columns={[
          { key: "code", header: "Code", cell: (row) => row.code },
          { key: "name", header: "Name", cell: (row) => <Link href={`/suppliers/${row.id}`}>{row.name}</Link> },
          { key: "contact", header: "Contact", cell: (row) => row.contactPerson ?? "" },
          { key: "phone", header: "Phone", cell: (row) => row.phone ?? "" },
          { key: "district", header: "District", cell: (row) => row.district ?? "" },
          { key: "owed", header: "The shop owes", cell: (row) => row.owed },
          { key: "status", header: "Status", cell: (row) => (row.status === "ACTIVE" ? "" : "Inactive") },
        ]}
        rows={found.rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No suppliers" description="No supplier matches, or none has been added yet." />}
      />
      <div className="flex items-center justify-end gap-2 text-sm">
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
    </div>
  );
}
