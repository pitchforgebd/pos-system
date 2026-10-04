import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listJournals } from "@/modules/accounting/books";

export const metadata = { title: "Accounting" };

export default async function AccountingPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const params = await searchParams;
  const q = params.q?.trim().toLowerCase() ?? "";
  const journals = (await listJournals(session.organizationId, session.branchId)).filter(
    (row) => !q || `${row.number ?? ""} ${row.description ?? ""}`.toLowerCase().includes(q),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounting"
        description="Posted journals for this branch. A journal is stored only when debit equals credit."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting" }]}
      />
      <form className="flex flex-wrap items-end gap-2" action="/accounting">
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          Search
          <input name="q" defaultValue={params.q ?? ""} placeholder="Number or description" className="h-10 rounded-md border border-border px-3" />
        </label>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <DataTable
        caption="Journals"
        columns={[
          { key: "number", header: "Journal", cell: (row) => <Link href={`/accounting/journals/${row.id}`}>{row.number ?? row.description ?? "Journal"}</Link> },
          { key: "date", header: "Date", cell: (row) => row.occurredOn },
          { key: "debit", header: "Debit", cell: (row) => row.debit },
          { key: "credit", header: "Credit", cell: (row) => row.credit },
          { key: "status", header: "Status", cell: (row) => row.status },
        ]}
        rows={journals}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No journals" description="Sales, purchases, expenses, and manual journals appear here after they post." />}
      />
    </div>
  );
}
