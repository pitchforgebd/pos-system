import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { getSession } from "@/modules/auth/current-session";
import { getCampaign } from "@/modules/sms/campaigns";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("Campaign");

const FIELD: Record<string, string> = {
  DISTRICT: "District",
  CUSTOMER_TYPE: "Customer type",
  LAST_PURCHASE_BEFORE: "Last bought before",
  LAST_PURCHASE_AFTER: "Last bought on or after",
  TOTAL_PURCHASE_MIN: "Bought in all at least",
  TOTAL_PURCHASE_MAX: "Bought in all at most",
  HAS_DUE: "Owes something",
  DUE_OLDER_THAN_DAYS: "Unpaid for more than (days)",
  BOUGHT_PRODUCT: "Bought the product",
  BOUGHT_CATEGORY: "Bought from the category",
};
const TONE: Record<string, "success" | "warning" | "error" | "neutral"> = { SENT: "success", QUEUED: "warning", SENDING: "warning", FAILED: "error" };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const { id } = await params;
  const campaign = /^[0-9a-f-]{36}$/i.test(id) ? await getCampaign(session.organizationId, id) : null;
  if (!campaign) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={campaign.name}
        description={`${campaign.kind === "DUE_REMINDER" ? "Due reminder" : "Offer"} to ${campaign.recipients ?? 0} customer(s), ${campaign.parts ?? 0} SMS${campaign.cost ? `, about ${campaign.cost} Tk` : ""}.`}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "SMS", href: "/sms" }, { label: "Campaigns", href: "/sms/campaigns" }, { label: campaign.name }]}
      />
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <Figure label={ph("Delivered to the provider")} value={campaign.sent ?? 0} />
        <Figure label={ph("Waiting")} value={campaign.waiting ?? 0} />
        <Figure label={ph("Failed after all tries")} value={campaign.failed ?? 0} />
      </dl>
      <section className="space-y-1 text-sm">
        <p>
          <span className="text-muted">{ph("Message:")}</span> {campaign.body}
        </p>
        {campaign.offerText ? (
          <p>
            <span className="text-muted">{ph("Offer text:")}</span> {campaign.offerText}
          </p>
        ) : null}
        <p>
          <span className="text-muted">{ph("Who:")}</span> {campaign.filters.length === 0 ? ph("every customer who can get an SMS") : campaign.filters.map((row) => `${FIELD[row.field] ?? row.field}: ${row.value}`).join("; ")}
        </p>
      </section>
      <DataTable
        caption={ph("Messages")}
        columns={[
          { key: "customer", header: ph("Customer"), cell: (row) => (row.customer ? <Link href={`/customers/${row.customer.id}`}>{row.customer.name}</Link> : "") },
          { key: "to", header: ph("To"), cell: (row) => row.to },
          { key: "body", header: ph("Message"), cell: (row) => row.body },
          { key: "parts", header: ph("SMS"), cell: (row) => row.parts },
          { key: "status", header: ph("Status"), cell: (row) => <StatusBadge tone={TONE[row.status] ?? "neutral"}>{row.status}</StatusBadge> },
          { key: "note", header: ph("Note"), cell: (row) => row.note ?? "" },
        ]}
        rows={campaign.messages}
        getRowKey={(row) => row.id}
      />
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
