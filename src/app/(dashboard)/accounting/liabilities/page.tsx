import { redirect } from "next/navigation";

import { ChartAccountTable } from "@/components/accounting/chart-table";
import { PageHeader } from "@/components/ui/page-header";
import { getSession } from "@/modules/auth/current-session";
import { listAccounts } from "@/modules/accounting/books";

export const metadata = { title: "Liabilities" };

export default async function LiabilitiesPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const accounts = await listAccounts(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Liabilities"
        description="Accounts payable already moves with purchases and supplier payments. A separate liability received or paid document is not posted."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Accounting", href: "/accounting" }, { label: "Liabilities" }]}
      />
      <ChartAccountTable rows={accounts.filter((account) => account.groupCode === "2000")} />
    </div>
  );
}
