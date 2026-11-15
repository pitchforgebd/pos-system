import Link from "next/link";
import { redirect } from "next/navigation";

import { CampaignForm } from "@/components/sms/campaign-form";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { campaignChoices, listCampaigns } from "@/modules/sms/campaigns";

export const metadata = { title: "Offer Campaigns" };

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const kind = (await searchParams).kind === "DUE_REMINDER" ? "DUE_REMINDER" : "OFFER";
  const [campaigns, choices] = await Promise.all([listCampaigns(session.organizationId), campaignChoices(session.organizationId)]);
  const reminder = kind === "DUE_REMINDER";

  return (
    <div className="space-y-8">
      <PageHeader
        title={reminder ? "Due reminders" : "Offer campaigns"}
        description={reminder ? "An SMS to every customer whose invoice is overdue, with what each owes. It goes through the same outbox as every SMS." : "Choose who (district, type, when they last bought, what they bought, whether they owe), write the offer, look at the preview with the number of SMS and the cost, then send."}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "SMS", href: "/sms" }, { label: reminder ? "Due reminders" : "Campaigns" }]}
        actions={
          <Link href={reminder ? "/sms/campaigns" : "/sms/campaigns?kind=DUE_REMINDER"} className="text-sm font-medium text-primary">
            {reminder ? "Offer campaigns" : "Due reminders"}
          </Link>
        }
      />
      <CampaignForm
        key={kind}
        kind={kind}
        districts={choices.districts}
        types={choices.types}
        categories={choices.categories}
        products={choices.products}
        templates={choices.templates.filter((row) => row.kind === kind)}
        canSend={session.permissions.has("sms.campaign")}
      />
      <DataTable
        caption="Campaigns sent"
        columns={[
          { key: "name", header: "Campaign", cell: (row) => <Link href={`/sms/campaigns/${row.id}`}>{row.name}</Link> },
          { key: "kind", header: "Kind", cell: (row) => (row.kind === "DUE_REMINDER" ? "Due reminder" : "Offer") },
          { key: "when", header: "Sent", cell: (row) => (row.queuedAt ? row.queuedAt.slice(0, 16).replace("T", " ") : "") },
          { key: "to", header: "Customers", cell: (row) => row.recipients },
          { key: "parts", header: "SMS", cell: (row) => row.parts },
          { key: "sent", header: "Delivered to provider", cell: (row) => row.sent },
          { key: "waiting", header: "Waiting", cell: (row) => row.waiting },
          { key: "failed", header: "Failed", cell: (row) => row.failed },
          { key: "cost", header: "Cost", cell: (row) => row.cost ?? "" },
        ]}
        rows={campaigns}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No campaigns yet" description="A campaign you send shows here with how many went out." />}
      />
    </div>
  );
}
