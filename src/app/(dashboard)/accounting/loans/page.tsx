import { redirect } from "next/navigation";

import { ChartAccountTable } from "@/components/accounting/chart-table";
import { LoanForm } from "@/components/accounting/forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { listLoanMovements, listLoanRows } from "@/modules/accounting/unposted";
import { getSession } from "@/modules/auth/current-session";
import { listAccounts } from "@/modules/accounting/books";

export const metadata = { title: "Loan" };

export default async function LoansPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const [accounts, loans, movements] = await Promise.all([
    listAccounts(session.organizationId),
    listLoanRows(session.organizationId),
    session.branchId ? listLoanMovements(session.organizationId, session.branchId) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Loan"
        description="A loan received debits cash or bank and credits loans. A loan paid debits loans and credits cash or bank."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: "Loan" }]}
      />
      {session.permissions.has("accounting.post") && session.branchId ? (
        <LoanForm moneyAccounts={accounts.filter((account) => account.status === "ACTIVE" && (account.code === "1100" || account.code.startsWith("12"))).map((account) => ({ code: account.code, label: `${account.code} · ${account.name}` }))} />
      ) : null}
      <ChartAccountTable rows={accounts.filter((account) => account.code === "2200")} />
      <DataTable
        caption="Loan movements"
        columns={[
          { key: "date", header: "Date", cell: (row) => row.occurredOn },
          { key: "number", header: "Voucher", cell: (row) => row.number },
          { key: "description", header: "Description", cell: (row) => row.description },
          { key: "debit", header: "Paid", cell: (row) => row.debit },
          { key: "credit", header: "Received", cell: (row) => row.credit },
        ]}
        rows={movements}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No loan movement" description="Post a loan received or a loan paid." />}
      />
      <DataTable
        caption="Loans"
        columns={[
          { key: "lender", header: "Lender", cell: (row) => row.lender },
          { key: "date", header: "Recorded", cell: (row) => row.createdOn },
        ]}
        rows={loans}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No loan" description="A lender is recorded when a loan is received or paid." />}
      />
    </div>
  );
}
