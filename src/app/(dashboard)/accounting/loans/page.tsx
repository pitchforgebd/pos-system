import { redirect } from "next/navigation";

import { ChartAccountTable } from "@/components/accounting/chart-table";
import { LoanForm } from "@/components/accounting/forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { listLoanMovements, listLoanRows } from "@/modules/accounting/unposted";
import { getSession } from "@/modules/auth/current-session";
import { listAccounts } from "@/modules/accounting/books";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Loan");

export default async function LoansPage() {
  const ph = await getPhrase();
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
        title={ph("Loan")}
        description={ph("A loan received debits cash or bank and credits loans. A loan paid debits loans and credits cash or bank.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: ph("Loan") }]}
      />
      {session.permissions.has("accounting.post") && session.branchId ? (
        <LoanForm moneyAccounts={accounts.filter((account) => account.status === "ACTIVE" && ["CASH", "BANK", "MOBILE"].includes(account.kind)).map((account) => ({ code: account.code, kind: account.kind, label: `${account.code} · ${account.name}` }))} />
      ) : null}
      <ChartAccountTable rows={accounts.filter((account) => account.roles.includes("LOAN"))} />
      <DataTable
        caption={ph("Loan movements")}
        columns={[
          { key: "date", header: ph("Date"), cell: (row) => row.businessDate },
          { key: "number", header: ph("Voucher"), cell: (row) => row.number },
          { key: "description", header: ph("Description"), cell: (row) => row.description },
          { key: "debit", header: ph("Paid"), cell: (row) => row.debit },
          { key: "credit", header: ph("Received"), cell: (row) => row.credit },
        ]}
        rows={movements}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No loan movement")} description={ph("Post a loan received or a loan paid.")} />}
      />
      <DataTable
        caption={ph("Loans")}
        columns={[
          { key: "lender", header: ph("Lender"), cell: (row) => row.lender },
          { key: "date", header: ph("Recorded"), cell: (row) => row.createdOn },
        ]}
        rows={loans}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No loan")} description={ph("A lender is recorded when a loan is received or paid.")} />}
      />
    </div>
  );
}
