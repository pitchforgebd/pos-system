import Link from "next/link";
import { redirect } from "next/navigation";

import { SendWaitingForm } from "@/components/sms/forms";
import { SmsMetrics } from "@/components/sms/metrics";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { getSession } from "@/modules/auth/current-session";
import { listMessages, smsDashboard } from "@/modules/sms/sms";
import { phraseTitled } from "@/lib/i18n/metadata";
import { getPhrase } from "@/lib/i18n/server";

export const generateMetadata = phraseTitled("SMS");

export default async function SmsPage() {
  const ph = await getPhrase();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const [figures, messages] = await Promise.all([
    smsDashboard(session.organizationId),
    listMessages(session.organizationId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ph("SMS")}
        description={ph("Every message goes through the outbox: it is sent right after it is written, and a failure is tried again three times. An SMS never holds up or undoes a sale or a payment.")}
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: ph("SMS") }]}
        actions={
          <>
            <Button href="/sms/send">{ph("Send SMS")}</Button>
            <Button href="/sms/campaigns" variant="secondary">
              {ph("Offer campaigns")}
            </Button>
          </>
        }
      />
      <SmsMetrics figures={figures} />
      {figures.queued > 0 ? <SendWaitingForm waiting={figures.queued} configured={figures.provider !== null} /> : null}
      <DataTable
        caption={ph("Recent messages")}
        columns={[
          { key: "date", header: ph("Date"), cell: (row) => row.createdAt.slice(0, 10) },
          { key: "to", header: ph("To"), cell: (row) => row.recipient },
          { key: "parts", header: ph("SMS"), cell: (row) => row.parts },
          { key: "status", header: ph("Status"), cell: (row) => row.status },
          { key: "result", header: ph("Note"), cell: (row) => (row.status === "SENT" ? "" : row.result) },
        ]}
        rows={messages.slice(0, 20)}
        getRowKey={(row) => row.id}
        empty={<EmptyState title={ph("No messages")} description={ph("Messages appear here as soon as they are written to the outbox.")} />}
      />
      <p className="text-sm">
        <Link href="/sms/history">{ph("History")}</Link>
      </p>
    </div>
  );
}
