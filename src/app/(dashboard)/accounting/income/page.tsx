import { redirect } from "next/navigation";

import { ChartAccountTable } from "@/components/accounting/chart-table";
import { IncomeForm } from "@/components/accounting/forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { GROUP } from "@/core/ledger/groups";
import { EmptyState } from "@/components/ui/states";
import { listIncomeRows } from "@/modules/accounting/unposted";
import { getSession } from "@/modules/auth/current-session";
import { listAccounts } from "@/modules/accounting/books";

export const metadata = { title: "Direct/Indirect Incomes" };

export default async function IncomePage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const [accounts, incomeRows] = await Promise.all([
    listAccounts(session.organizationId),
    session.branchId ? listIncomeRows(session.organizationId, session.branchId) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Direct/Indirect Incomes"
        description="Other income debits cash or a bank account and credits an income account. Sales stay on invoices."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: "Income" }]}
      />
      {session.permissions.has("accounting.post") && session.branchId ? (
        <IncomeForm
          accounts={accounts.filter((account) => account.status === "ACTIVE" && account.groupCode === GROUP.REVENUE && !account.roles.includes("SALES")).map((account) => ({ code: account.code, label: `${account.code} · ${account.name}` }))}
          moneyAccounts={accounts.filter((account) => account.status === "ACTIVE" && ["CASH", "BANK", "MOBILE"].includes(account.kind)).map((account) => ({ code: account.code, kind: account.kind, label: `${account.code} · ${account.name}` }))}
        />
      ) : null}
      <ChartAccountTable rows={accounts.filter((account) => account.groupCode === GROUP.REVENUE)} />
      <DataTable
        caption="Income documents"
        columns={[
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "category", header: "Category", cell: (row) => row.category },
          { key: "amount", header: "Amount", cell: (row) => row.amount },
          { key: "posted", header: "Journal", cell: (row) => row.posted },
        ]}
        rows={incomeRows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No income document" description="Post other income to debit cash or bank and credit an income account." />}
      />
    </div>
  );
}
