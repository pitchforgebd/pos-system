import Link from "next/link";
import { redirect } from "next/navigation";

import { BankForm } from "@/components/accounting/forms";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { cashBankBalances, cashFlow } from "@/modules/accounting/books";

export const metadata = { title: "Bank & Cash" };

function dated(from?: string, to?: string) {
  return Boolean(from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to));
}

export default async function BankCashPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const query = await searchParams;
  const range = dated(query.from, query.to);
  const [balances, flow] = await Promise.all([
    cashBankBalances(session.organizationId, session.branchId),
    cashFlow(session.organizationId, session.branchId, range ? query.from : undefined, range ? query.to : undefined),
  ]);
  const cash = balances.find((row) => row.code === "1100");
  const bank = balances.find((row) => row.code === "1200");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bank & Cash"
        description="Cash in hand is account 1100. The pooled bank is 1200. Each added bank gets its own code from 1201. An opening amount debits that bank and credits owner capital."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: "Bank & Cash" }]}
      />
      {session.permissions.has("accounting.post") ? <BankForm /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/accounting/statements?accountCode=1100" className="rounded-xl bg-[#0f8f78] px-4 py-4 text-white">
          <span className="text-xs font-semibold tracking-wide">CASH IN HAND</span>
          <span className="mt-3 block text-2xl font-semibold">{cash?.balance ?? "0.00"}</span>
        </Link>
        <Link href="/accounting/statements?accountCode=1200" className="rounded-xl bg-[#5b4bdb] px-4 py-4 text-white">
          <span className="text-xs font-semibold tracking-wide">CASH AT BANK</span>
          <span className="mt-3 block text-2xl font-semibold">{bank?.balance ?? "0.00"}</span>
        </Link>
      </div>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Cash flow</h2>
        <form className="flex flex-wrap items-end gap-2" action="/accounting/bank-cash">
          <label className="grid gap-1 text-sm">
            From
            <input name="from" type="date" defaultValue={query.from ?? ""} className="h-10 rounded-md border border-border px-3" />
          </label>
          <label className="grid gap-1 text-sm">
            To
            <input name="to" type="date" defaultValue={query.to ?? ""} className="h-10 rounded-md border border-border px-3" />
          </label>
          <Button type="submit" variant="secondary">
            Show
          </Button>
        </form>
        <p className="text-sm text-muted">{range ? `${query.from} to ${query.to}` : "All posted cash and bank lines"}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm">In <span className="mt-1 block text-lg font-semibold">{flow.inflow}</span></p>
          <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm">Out <span className="mt-1 block text-lg font-semibold">{flow.outflow}</span></p>
          <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm">Net <span className="mt-1 block text-lg font-semibold">{flow.net}</span></p>
        </div>
      </section>
      <DataTable
        caption="Cash and bank"
        columns={[
          { key: "code", header: "Code", cell: (row) => row.code },
          { key: "name", header: "Account", cell: (row) => row.name },
          { key: "balance", header: "Balance", cell: (row) => row.balance },
          {
            key: "ledger",
            header: "Ledger",
            cell: (row) => <Link href={`/accounting/statements?accountCode=${row.code}`}>Statement</Link>,
          },
        ]}
        rows={balances}
        getRowKey={(row) => row.code}
      />
    </div>
  );
}
