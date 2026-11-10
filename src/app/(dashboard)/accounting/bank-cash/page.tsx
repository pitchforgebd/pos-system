import Link from "next/link";
import { redirect } from "next/navigation";

import { BankForm, OpeningCashForm } from "@/components/accounting/forms";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { cashBankBalances, cashFlow, openingCashEntered } from "@/modules/accounting/books";

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
  const [balances, flow, openingDone] = await Promise.all([
    cashBankBalances(session.organizationId, session.branchId),
    cashFlow(session.organizationId, session.branchId, range ? query.from : undefined, range ? query.to : undefined),
    openingCashEntered(session.organizationId, session.branchId),
  ]);
  const cash = balances.find((row) => row.kind === "CASH");
  // The bank figure on this page is the default bank account, as before; each account has its own row in the table below.
  const bank = balances.find((row) => row.kind === "BANK");
  const canPost = session.permissions.has("accounting.post");
  const typeLabel = { CASH: "Cash", BANK: "Bank", MOBILE: "Mobile banking" } as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bank & Cash"
        description="Cash in hand and the default bank are set up with the books. Add each bank and each mobile banking account (bKash, Nagad, ...) you use: it gets a number of its own and its own ledger. Opening amounts go against Opening Balance Equity, not the owner's capital."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: "Bank & Cash" }]}
      />
      {canPost && !openingDone ? (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Opening cash</h2>
          <OpeningCashForm />
        </section>
      ) : null}
      {canPost ? (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Add a bank or mobile account</h2>
          <BankForm />
        </section>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href={`/accounting/statements?accountCode=${cash?.code ?? ""}`} className="rounded-xl bg-[#0f8f78] px-4 py-4 text-white">
          <span className="text-xs font-semibold tracking-wide">CASH IN HAND</span>
          <span className="mt-3 block text-2xl font-semibold">{cash?.balance ?? "0.00"}</span>
        </Link>
        <Link href={`/accounting/statements?accountCode=${bank?.code ?? ""}`} className="rounded-xl bg-[#5b4bdb] px-4 py-4 text-white">
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
          { key: "kind", header: "Type", cell: (row) => typeLabel[row.kind as keyof typeof typeLabel] ?? row.kind },
          { key: "bank", header: "Bank / branch", cell: (row) => [row.bankName, row.bankBranch].filter(Boolean).join(" · ") || "—" },
          { key: "number", header: "Number", cell: (row) => row.accountNumber ?? "—" },
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
