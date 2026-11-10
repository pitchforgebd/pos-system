import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { accountStatement, defaultStatementRange, listAccounts } from "@/modules/accounting/books";

export const metadata = { title: "Account statement" };

export default async function StatementsPage({ searchParams }: { searchParams: Promise<{ accountCode?: string; from?: string; to?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const given = await searchParams;
  // A link to an account's ledger needs no dates: it opens on the current fiscal year up to today.
  const range = given.accountCode && (!given.from || !given.to) ? await defaultStatementRange(session.organizationId) : null;
  const query = { ...given, from: given.from || range?.from, to: given.to || range?.to };
  const accounts = await listAccounts(session.organizationId);
  const ready = Boolean(query.accountCode && query.from && query.to && /^\d{4}-\d{2}-\d{2}$/.test(query.from) && /^\d{4}-\d{2}-\d{2}$/.test(query.to));
  const statement = ready
    ? await accountStatement({
        organizationId: session.organizationId,
        branchId: session.branchId,
        accountCode: query.accountCode ?? "",
        from: query.from ?? "",
        to: query.to ?? "",
      })
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Account Statement"
        description="Opening is debit minus credit before the start date. Each later line updates that running balance. Cash and bank in and out are on Bank & Cash."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: "Statement" }]}
      />
      <form className="grid max-w-xl gap-3" method="get">
        <label className="grid gap-1 text-sm">
          Account
          <select name="accountCode" defaultValue={query.accountCode} className="h-10 rounded-md border border-border bg-surface px-2" required>
            {accounts.map((account) => (
              <option key={account.id} value={account.code}>{account.code} · {account.name}</option>
            ))}
          </select>
        </label>
        <input name="from" type="date" required defaultValue={query.from} aria-label="From" className="h-10 rounded-md border border-border bg-surface px-2" />
        <input name="to" type="date" required defaultValue={query.to} aria-label="To" className="h-10 rounded-md border border-border bg-surface px-2" />
        <Button type="submit">Show statement</Button>
      </form>
      {statement ? <p className="text-sm">Opening {statement.opening} for {statement.account.code} · {statement.account.name}</p> : null}
      {ready ? (
        <DataTable
          caption="Statement lines"
          columns={[
            { key: "date", header: "Date", cell: (row) => row.businessDate },
            { key: "reference", header: "Reference", cell: (row) => row.reference },
            { key: "debit", header: "Debit", cell: (row) => row.debit },
            { key: "credit", header: "Credit", cell: (row) => row.credit },
            { key: "balance", header: "Balance", cell: (row) => row.balance },
          ]}
          rows={statement?.lines ?? []}
          getRowKey={(row) => row.id}
          empty={<EmptyState title="No lines in this range" description="Posted journal lines for the account and dates will appear here." />}
        />
      ) : null}
    </div>
  );
}
