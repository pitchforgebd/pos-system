import { redirect } from "next/navigation";

import { TierForm } from "@/components/customers/forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listLoyaltyTiers } from "@/modules/customers/loyalty";

export const metadata = { title: "Loyalty tiers" };

export default async function LoyaltyTiersPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const tiers = await listLoyaltyTiers(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Loyalty tiers"
        description="Minimum spend and the discount percent are stored. A sale still uses the product selling price, and tiers do not auto-upgrade."
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Loyalty", href: "/customers/loyalty" }, { label: "Tiers" }]}
      />
      {session.permissions.has("loyalty.manage") ? <TierForm /> : null}
      <DataTable
        caption="Tiers"
        columns={[
          { key: "name", header: "Tier", cell: (row) => row.name },
          { key: "spend", header: "Minimum spend", cell: (row) => row.minimumSpend },
          { key: "discount", header: "Stored percent", cell: (row) => row.discountPercent },
          { key: "status", header: "Status", cell: (row) => row.status },
        ]}
        rows={tiers}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No tiers" description="Add a tier name, a minimum spend, and a stored percent." />}
      />
    </div>
  );
}
