import { redirect } from "next/navigation";

import { DateFilter } from "@/components/reports/filter";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { trialBalance } from "@/modules/reports/reports";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Trial balance");

export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session?.branchId) {
    redirect("/login");
  }
  const query = await searchParams;
  const report = await trialBalance({ organizationId: session.organizationId, branchId: session.branchId, from: query.from, to: query.to });

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Trial balance")}
        description={`Debit ${report.debit}. Credit ${report.credit}.`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Reports", href: "/reports" }, { label: ph("Trial balance") }]}
        actions={<Button href="/reports" variant="secondary">{ph("Back to reports")}</Button>}
      />
      <DateFilter from={query.from} to={query.to} />
      <DataTable
        caption={ph("Posted accounts")}
        columns={[
          { key: "account", header: ph("Account"), cell: (row) => `${row.code} ${row.name}` },
          { key: "debit", header: ph("Debit"), cell: (row) => row.debit },
          { key: "credit", header: ph("Credit"), cell: (row) => row.credit },
        ]}
        rows={report.rows}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No posted lines")} description={ph("Posted journal lines on this branch appear here.")} />}
      />
    </div>
  );
}
