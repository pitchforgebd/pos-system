import { redirect } from "next/navigation";

import { ChartAccountTable } from "@/components/accounting/chart-table";
import { CapitalForm } from "@/components/accounting/forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { listCapitalRows } from "@/modules/accounting/unposted";
import { getSession } from "@/modules/auth/current-session";
import { listAccounts } from "@/modules/accounting/books";

export const metadata = { title: "Capital" };

export default async function CapitalPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const [accounts, capitalRows] = await Promise.all([
    listAccounts(session.organizationId),
    session.branchId ? listCapitalRows(session.organizationId, session.branchId) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Capital"
        description="Capital added debits cash or bank and credits owner capital. A withdrawal debits drawings and credits cash or bank."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: "Capital" }]}
      />
      {session.permissions.has("accounting.post") && session.branchId ? (
        <CapitalForm moneyAccounts={accounts.filter((account) => account.status === "ACTIVE" && (account.code === "1100" || account.code.startsWith("12"))).map((account) => ({ code: account.code, label: `${account.code} · ${account.name}` }))} />
      ) : null}
      <ChartAccountTable rows={accounts.filter((account) => account.groupCode === "3000")} />
      <DataTable
        caption="Capital documents"
        columns={[
          { key: "date", header: "Date", cell: (row) => row.businessDate },
          { key: "type", header: "Type", cell: (row) => row.capitalType },
          { key: "owner", header: "Owner", cell: (row) => row.ownerName },
          { key: "amount", header: "Amount", cell: (row) => row.amount },
          { key: "posted", header: "Journal", cell: (row) => row.posted },
        ]}
        rows={capitalRows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No capital document" description="Post capital added or capital withdrawn." />}
      />
    </div>
  );
}
