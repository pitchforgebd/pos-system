import Link from "next/link";
import { redirect } from "next/navigation";

import { ExpenseForm } from "@/components/accounting/forms";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listAccounts, listExpenses } from "@/modules/accounting/books";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const params = await searchParams;
  const q = params.q?.trim().toLowerCase() ?? "";
  const [accounts, expenses] = await Promise.all([
    listAccounts(session.organizationId),
    listExpenses(session.organizationId, session.branchId),
  ]);
  const rows = expenses.filter((row) => !q || `${row.number ?? ""} ${row.accountName} ${row.note ?? ""}`.toLowerCase().includes(q));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="An expense debits an expense account and credits cash or bank."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: "Expenses" }]}
      />
      {session.permissions.has("accounting.post") ? (
        <ExpenseForm accounts={accounts.filter((account) => account.status === "ACTIVE" && account.groupCode === "6000").map((account) => ({ code: account.code, label: `${account.code} · ${account.name}` }))} />
      ) : null}
      <form className="flex flex-wrap items-end gap-2" action="/accounting/expenses">
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          Search
          <input name="q" defaultValue={params.q ?? ""} placeholder="Number, account, or note" className="h-10 rounded-md border border-border px-3" />
        </label>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <DataTable
        caption="Expenses"
        columns={[
          { key: "number", header: "Expense", cell: (row) => row.journalId ? <Link href={`/accounting/journals/${row.journalId}`}>{row.number}</Link> : row.number },
          { key: "date", header: "Date", cell: (row) => row.occurredOn },
          { key: "account", header: "Account", cell: (row) => row.accountName },
          { key: "amount", header: "Amount", cell: (row) => row.amount },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No expenses" description="Post an expense to reduce cash or bank and increase an expense account." />}
      />
    </div>
  );
}
