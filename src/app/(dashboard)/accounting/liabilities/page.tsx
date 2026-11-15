import { redirect } from "next/navigation";

import { ChartAccountTable } from "@/components/accounting/chart-table";
import { PageHeader } from "@/components/ui/page-header";
import { GROUP } from "@/core/ledger/groups";
import { getSession } from "@/modules/auth/current-session";
import { listAccounts } from "@/modules/accounting/books";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Liabilities");

export default async function LiabilitiesPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const accounts = await listAccounts(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Liabilities")}
        description={ph("Accounts payable already moves with purchases and supplier payments. A separate liability received or paid document is not posted.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: ph("Liabilities") }]}
      />
      <ChartAccountTable rows={accounts.filter((account) => account.groupCode === GROUP.LIABILITY)} />
    </div>
  );
}
