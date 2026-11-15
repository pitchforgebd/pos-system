import { redirect } from "next/navigation";

import { CardForm } from "@/components/customers/forms";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listCustomers } from "@/modules/customers/customers";
import { listLoyaltyCards, listLoyaltyTiers } from "@/modules/customers/loyalty";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Loyalty cards");

export default async function LoyaltyCardsPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const [customers, tiers, cards] = await Promise.all([
    listCustomers(session.organizationId),
    listLoyaltyTiers(session.organizationId),
    listLoyaltyCards(session.organizationId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("Loyalty cards")}
        description={ph("Issue one card with a number, a customer, and an optional tier. Cards are not generated in a batch, and they do not earn or redeem points.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Loyalty", href: "/customers/loyalty" }, { label: ph("Cards") }]}
      />
      {session.permissions.has("loyalty.manage") ? (
        <CardForm
          customers={customers.filter((customer) => customer.status === "ACTIVE").map((customer) => ({ id: customer.id, label: customer.name }))}
          tiers={tiers.filter((tier) => tier.status === "ACTIVE").map((tier) => ({ id: tier.id, label: tier.name }))}
        />
      ) : null}
      <DataTable
        caption={ph("Cards")}
        columns={[
          { key: "number", header: ph("Card"), cell: (row) => row.number },
          { key: "customer", header: ph("Customer"), cell: (row) => row.customerName },
          { key: "tier", header: ph("Tier"), cell: (row) => row.tierName ?? "" },
          { key: "issued", header: ph("Issued"), cell: (row) => row.issuedOn },
          { key: "expires", header: ph("Expires"), cell: (row) => row.expiresOn ?? "" },
          { key: "status", header: ph("Status"), cell: (row) => row.status },
        ]}
        rows={cards}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No cards")} description={ph("Issue a card when the customer and card number are known.")} />}
      />
    </div>
  );
}
