import { redirect } from "next/navigation";

import { TierForm } from "@/components/customers/forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listLoyaltyTiers } from "@/modules/customers/loyalty";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Loyalty tiers");

export default async function LoyaltyTiersPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const tiers = await listLoyaltyTiers(session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Loyalty tiers")}
        description={ph("Minimum spend and the discount percent are stored. A sale still uses the product selling price, and tiers do not auto-upgrade.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Loyalty", href: "/customers/loyalty" }, { label: ph("Tiers") }]}
      />
      {session.permissions.has("loyalty.manage") ? <TierForm /> : null}
      <DataTable
        caption={ph("Tiers")}
        columns={[
          { key: "name", header: ph("Tier"), cell: (row) => row.name },
          { key: "spend", header: ph("Minimum spend"), cell: (row) => row.minimumSpend },
          { key: "discount", header: ph("Stored percent"), cell: (row) => row.discountPercent },
          { key: "status", header: ph("Status"), cell: (row) => row.status },
        ]}
        rows={tiers}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No tiers")} description={ph("Add a tier name, a minimum spend, and a stored percent.")} />}
      />
    </div>
  );
}
