import { redirect } from "next/navigation";

import { ChartAccountTable } from "@/components/accounting/chart-table";
import { PageHeader } from "@/components/ui/page-header";
import { GROUP } from "@/core/ledger/groups";
import { getSession } from "@/modules/auth/current-session";
import { listAccounts } from "@/modules/accounting/books";

export const metadata = { title: "Assets" };

export default async function AssetsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const accounts = await listAccounts(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assets"
        description="These asset accounts already receive journals from sales, purchases, and cash. A separate fixed-asset document is not posted."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: "Assets" }]}
      />
      <ChartAccountTable rows={accounts.filter((account) => account.groupCode === GROUP.ASSET)} />
    </div>
  );
}
