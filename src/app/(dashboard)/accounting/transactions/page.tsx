import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listCashBankLines } from "@/modules/accounting/books";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Transaction");

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; q?: string }> }) {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const query = await searchParams;
  const dated = Boolean(query.from && query.to && /^\d{4}-\d{2}-\d{2}$/.test(query.from) && /^\d{4}-\d{2}-\d{2}$/.test(query.to));
  const q = query.q?.trim().toLowerCase() ?? "";
  const rows = (await listCashBankLines(session.organizationId, session.branchId, dated ? query.from : undefined, dated ? query.to : undefined)).filter((row) => {
    if (!q) {
      return true;
    }
    return `${row.reference} ${row.description ?? ""} ${row.accountName} ${row.source}`.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Transaction")}
        description={ph("Posted cash and bank lines for this branch. The source is the document that created the journal.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: ph("Transaction") }]}
      />
      <form className="flex flex-wrap items-end gap-2" action="/accounting/transactions">
        <label className="grid gap-1 text-sm">
          {ph("From")}
          <input name="from" type="date" defaultValue={query.from ?? ""} className="h-10 rounded-md border border-border px-3" />
        </label>
        <label className="grid gap-1 text-sm">
          {ph("To")}
          <input name="to" type="date" defaultValue={query.to ?? ""} className="h-10 rounded-md border border-border px-3" />
        </label>
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          {ph("Search")}
          <input name="q" defaultValue={query.q ?? ""} placeholder={ph("Reference, account, or source")} className="h-10 rounded-md border border-border px-3" />
        </label>
        <Button type="submit" variant="secondary">
          {ph("Filter")}
        </Button>
      </form>
      <DataTable
        caption={ph("Cash and bank")}
        columns={[
          { key: "date", header: ph("Date"), cell: (row) => row.businessDate },
          { key: "reference", header: ph("Reference"), cell: (row) => row.reference },
          { key: "source", header: ph("Source"), cell: (row) => row.source },
          { key: "account", header: ph("Cash / bank"), cell: (row) => row.accountName },
          { key: "debit", header: ph("Debit"), cell: (row) => row.debit },
          { key: "credit", header: ph("Credit"), cell: (row) => row.credit },
          { key: "direction", header: ph("CR/DR"), cell: (row) => row.direction },
          { key: "user", header: ph("Added by"), cell: (row) => row.user },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No cash or bank lines")} description={ph("Sales, expenses, and transfers that touch cash or bank appear here.")} />}
      />
    </div>
  );
}
