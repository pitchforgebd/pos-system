import Link from "next/link";
import { redirect } from "next/navigation";

import { JournalForm } from "@/components/accounting/forms";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listAccounts, listJournals } from "@/modules/accounting/books";

export const metadata = { title: "Journals" };

export default async function JournalsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const params = await searchParams;
  const q = params.q?.trim().toLowerCase() ?? "";
  const [accounts, journals] = await Promise.all([
    listAccounts(session.organizationId),
    listJournals(session.organizationId, session.branchId),
  ]);
  const rows = journals.filter((row) => !q || `${row.number ?? ""} ${row.description ?? ""}`.toLowerCase().includes(q));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Journals"
        description="A posted journal is corrected by a reversal, not by editing the lines."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: "Journals" }]}
      />
      {session.permissions.has("accounting.post") ? (
        <JournalForm accounts={accounts.filter((account) => account.status === "ACTIVE").map((account) => ({ code: account.code, label: `${account.code} · ${account.name}` }))} />
      ) : null}
      <form className="flex flex-wrap items-end gap-2" action="/accounting/journals">
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
          { key: "number", header: "Journal", cell: (row) => <Link href={`/accounting/journals/${row.id}`}>{row.number ?? "Journal"}</Link> },
          { key: "date", header: "Date", cell: (row) => row.occurredOn },
          { key: "description", header: "Description", cell: (row) => row.description },
          { key: "debit", header: "Debit", cell: (row) => row.debit },
          { key: "credit", header: "Credit", cell: (row) => row.credit },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No journals" description="Post a balanced journal to record a manual entry." />}
      />
    </div>
  );
}
