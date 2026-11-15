import Link from "next/link";
import { redirect } from "next/navigation";

import { JournalForm } from "@/components/accounting/forms";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listAccounts, listJournals } from "@/modules/accounting/books";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Journals");

export default async function JournalsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ph = await getPhrase();
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
        title={ph("Journals")}
        description={ph("A posted journal is corrected by a reversal, not by editing the lines.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: ph("Journals") }]}
      />
      {session.permissions.has("accounting.post") ? (
        <JournalForm accounts={accounts.filter((account) => account.status === "ACTIVE").map((account) => ({ code: account.code, label: `${account.code} · ${account.name}` }))} />
      ) : null}
      <form className="flex flex-wrap items-end gap-2" action="/accounting/journals">
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          {ph("Search")}
          <input name="q" defaultValue={params.q ?? ""} placeholder={ph("Number or description")} className="h-10 rounded-md border border-border px-3" />
        </label>
        <Button type="submit" variant="secondary">
          {ph("Search")}
        </Button>
      </form>
      <DataTable
        caption={ph("Journals")}
        columns={[
          { key: "number", header: ph("Journal"), cell: (row) => <Link href={`/accounting/journals/${row.id}`}>{row.number ?? ph("Journal")}</Link> },
          { key: "date", header: ph("Date"), cell: (row) => row.businessDate },
          { key: "description", header: ph("Description"), cell: (row) => row.description },
          { key: "debit", header: ph("Debit"), cell: (row) => row.debit },
          { key: "credit", header: ph("Credit"), cell: (row) => row.credit },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No journals")} description={ph("Post a balanced journal to record a manual entry.")} />}
      />
    </div>
  );
}
