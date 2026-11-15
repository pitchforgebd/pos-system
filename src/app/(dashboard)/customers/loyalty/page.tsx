import { redirect } from "next/navigation";

import { RedeemForm } from "@/components/reference/gap-forms";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listCustomers } from "@/modules/customers/customers";
import { listLoyaltyTransactions } from "@/modules/customers/loyalty";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Loyalty");

export default async function LoyaltyPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const [transactions, customers] = await Promise.all([
    listLoyaltyTransactions(session.organizationId),
    listCustomers(session.organizationId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Loyalty")}
        description={ph("A sale earns points when shop settings have points per hundred. Redeem uses taka per point from those settings and reduces the customer balance.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: ph("Loyalty") }]}
        actions={
          <div className="flex gap-2">
            <Button href="/customers/loyalty/tiers" variant="secondary">{ph("Tiers")}</Button>
            <Button href="/customers/loyalty/cards" variant="secondary">{ph("Cards")}</Button>
          </div>
        }
      />
      {session.permissions.has("loyalty.manage") ? (
        <RedeemForm customers={customers.filter((customer) => customer.status === "ACTIVE").map((customer) => ({ id: customer.id, label: customer.name }))} />
      ) : null}
      <DataTable
        caption={ph("Loyalty ledger")}
        columns={[
          { key: "date", header: ph("Date"), cell: (row) => row.businessDate },
          { key: "customer", header: ph("Customer"), cell: (row) => row.customerName },
          { key: "type", header: ph("Type"), cell: (row) => row.entryType },
          { key: "points", header: ph("Points"), cell: (row) => row.points },
        ]}
        rows={transactions}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No loyalty transactions")} description={ph("Set points per hundred on shop settings, then sell to a customer.")} />}
      />
    </div>
  );
}
