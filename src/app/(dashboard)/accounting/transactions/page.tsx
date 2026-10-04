import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listCashBankLines } from "@/modules/accounting/books";

export const metadata = { title: "Transaction" };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; q?: string }> }) {
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
        title="Transaction"
        description="Posted cash and bank lines for this branch. The source is the document that created the journal."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: "Transaction" }]}
      />
      <form className="flex flex-wrap items-end gap-2" action="/accounting/transactions">
        <label className="grid gap-1 text-sm">
          From
          <input name="from" type="date" defaultValue={query.from ?? ""} className="h-10 rounded-md border border-border px-3" />
        </label>
        <label className="grid gap-1 text-sm">
          To
          <input name="to" type="date" defaultValue={query.to ?? ""} className="h-10 rounded-md border border-border px-3" />
        </label>
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          Search
          <input name="q" defaultValue={query.q ?? ""} placeholder="Reference, account, or source" className="h-10 rounded-md border border-border px-3" />
        </label>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      <DataTable
        caption="Cash and bank"
        columns={[
          { key: "date", header: "Date", cell: (row) => row.occurredOn },
          { key: "reference", header: "Reference", cell: (row) => row.reference },
          { key: "source", header: "Source", cell: (row) => row.source },
          { key: "account", header: "Cash / bank", cell: (row) => row.accountName },
          { key: "debit", header: "Debit", cell: (row) => row.debit },
          { key: "credit", header: "Credit", cell: (row) => row.credit },
          { key: "direction", header: "CR/DR", cell: (row) => row.direction },
          { key: "user", header: "Added by", cell: (row) => row.user },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No cash or bank lines" description="Sales, expenses, and transfers that touch cash or bank appear here." />}
      />
    </div>
  );
}
