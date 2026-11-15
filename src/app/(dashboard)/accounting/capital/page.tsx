import { redirect } from "next/navigation";

import { ChartAccountTable } from "@/components/accounting/chart-table";
import { CapitalForm } from "@/components/accounting/forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { GROUP } from "@/core/ledger/groups";
import { EmptyState } from "@/components/ui/states";
import { listCapitalRows } from "@/modules/accounting/unposted";
import { getSession } from "@/modules/auth/current-session";
import { listAccounts } from "@/modules/accounting/books";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Capital");

export default async function CapitalPage() {
  const ph = await getPhrase();
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
        title={ph("Capital")}
        description={ph("Capital added debits cash or bank and credits owner capital. A withdrawal debits drawings and credits cash or bank.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: ph("Capital") }]}
      />
      {session.permissions.has("accounting.post") && session.branchId ? (
        <CapitalForm moneyAccounts={accounts.filter((account) => account.status === "ACTIVE" && ["CASH", "BANK", "MOBILE"].includes(account.kind)).map((account) => ({ code: account.code, kind: account.kind, label: `${account.code} · ${account.name}` }))} />
      ) : null}
      <ChartAccountTable rows={accounts.filter((account) => account.groupCode === GROUP.EQUITY)} />
      <DataTable
        caption={ph("Capital documents")}
        columns={[
          { key: "date", header: ph("Date"), cell: (row) => row.businessDate },
          { key: "type", header: ph("Type"), cell: (row) => row.capitalType },
          { key: "owner", header: ph("Owner"), cell: (row) => row.ownerName },
          { key: "amount", header: ph("Amount"), cell: (row) => row.amount },
          { key: "posted", header: ph("Journal"), cell: (row) => row.posted },
        ]}
        rows={capitalRows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No capital document")} description={ph("Post capital added or capital withdrawn.")} />}
      />
    </div>
  );
}
